/**
 * section-bundle-builder.js
 *
 * Native Web Components for the Bundle Builder section.
 * No framework. No Alpine. Lifecycle: connectedCallback / disconnectedCallback.
 *
 * Components defined here (Phase 2):
 *   <bundle-builder>        — root orchestrator; owns all builder state
 *   <bundle-step>           — single accordion step; open/close + selected-count badge
 *   <bundle-product-card>   — Liquid-rendered product card and state bridge
 *   <bundle-variant-selector> — product variant buttons
 *   <bundle-quantity-stepper> — product quantity controls
 *   <bundle-review-panel>   — review panel shell (wired in Phase 3)
 *
 * State model (ported from D:/Projects/Bundle-Builder/src/state/builder-provider.tsx):
 *   BuilderState = {
 *     activeStepIndex: number | null,   // which step is currently open
 *     selections: {
 *       [productId]: {
 *         activeVariantId: string | null,
 *         quantitiesByVariant: { [variantId]: number }
 *       }
 *     }
 *   }
 *
 * Phase 2 registers Liquid-rendered products and keeps active variants and
 * per-variant quantities synchronized with their card controls.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. <bundle-builder> — root orchestrator
// ─────────────────────────────────────────────────────────────────────────────

if (!customElements.get('bundle-builder')) {
  customElements.define('bundle-builder', class BundleBuilder extends HTMLElement {

    /** @type {Object} Parsed config from the inline JSON block */
    #config = null;

    /** @type {number|null} Index of the currently-open step */
    #activeStepIndex = null;

    /** @type {Map<string,Object>} productId → ProductSelection */
    #selections = new Map();

    /** @type {BundleStep[]} Ordered list of child step elements */
    #steps = [];

    // ── Lifecycle ──────────────────────────────────────────────────────────

    async connectedCallback() {
      await Promise.all([
        customElements.whenDefined('bundle-step'),
        customElements.whenDefined('bundle-product-card'),
        customElements.whenDefined('bundle-variant-selector'),
        customElements.whenDefined('bundle-quantity-stepper'),
      ]);
      if (!this.isConnected) return;

      this.#parseConfig();
      this.#collectSteps();
      this.#restoreOrDefault();
      this.#wireStepEvents();
      this.#syncAllSteps();
      this.#dispatchStateChange();
    }

    disconnectedCallback() {
      this.#steps.forEach((step) => step.removeEventListener('bb:step-toggle', this.#onStepToggle));
      this.#steps.forEach((step) => step.removeEventListener('bb:step-next', this.#onStepNext));
    }

    // ── Config parsing ─────────────────────────────────────────────────────

    #parseConfig() {
      const scriptEl = this.querySelector('script[data-bundle-config]');
      if (!scriptEl) {
        console.warn('[bundle-builder] No data-bundle-config script block found.');
        return;
      }
      try {
        this.#config = JSON.parse(scriptEl.textContent);
      } catch (err) {
        console.error('[bundle-builder] Failed to parse config JSON:', err);
      }
    }

    // ── Step discovery ─────────────────────────────────────────────────────

    #collectSteps() {
      // Only direct children of the steps section, in DOM order
      const stepsSection = this.querySelector('.bb-layout__steps');
      if (!stepsSection) return;
      this.#steps = Array.from(stepsSection.querySelectorAll('bundle-step'));
    }

    // ── Initial state ──────────────────────────────────────────────────────

    #restoreOrDefault() {
      // Find the first step with data-open-default="true"
      const defaultIndex = this.#steps.findIndex(
        (step) => step.dataset.openDefault === 'true'
      );

      this.#activeStepIndex = defaultIndex >= 0 ? defaultIndex : 0;

      let storedState = null;
      try {
        const storedValue = window.localStorage.getItem(this.#storageKey());
        storedState = storedValue ? JSON.parse(storedValue) : null;
      } catch (error) {
        console.warn('[bundle-builder] Saved state could not be restored.', error);
      }

      if (!storedState || typeof storedState !== 'object') return;

      if (storedState.activeStepIndex === null) {
        this.#activeStepIndex = null;
      } else if (
        Number.isInteger(storedState.activeStepIndex)
        && storedState.activeStepIndex >= 0
        && storedState.activeStepIndex < this.#steps.length
      ) {
        this.#activeStepIndex = storedState.activeStepIndex;
      }

      if (!storedState.selections || typeof storedState.selections !== 'object') return;

      for (const [productId, selection] of Object.entries(storedState.selections)) {
        if (!selection || typeof selection !== 'object') continue;
        if (!selection.quantitiesByVariant || typeof selection.quantitiesByVariant !== 'object') continue;

        const quantitiesByVariant = Object.fromEntries(
          Object.entries(selection.quantitiesByVariant)
            .filter(([, quantity]) => Number.isFinite(quantity) && quantity >= 0)
            .map(([variantId, quantity]) => [variantId, Math.floor(quantity)]),
        );
        const activeVariantId = selection.activeVariantId === null || typeof selection.activeVariantId === 'string'
          ? selection.activeVariantId
          : null;

        this.#selections.set(productId, { activeVariantId, quantitiesByVariant });
      }
    }

    #storageKey() {
      return `bundle-builder-state-${this.dataset.sectionId || 'default'}`;
    }

    // ── Step event wiring ──────────────────────────────────────────────────

    #wireStepEvents() {
      this.#steps.forEach((step) => {
        step.addEventListener('bb:step-toggle', this.#onStepToggle);
        step.addEventListener('bb:step-next',   this.#onStepNext);
      });
    }

    #onStepToggle = (event) => {
      const index = Number(event.detail.stepIndex);
      // Toggle: clicking an open step closes it (sets null); clicking closed opens it
      this.#activeStepIndex = this.#activeStepIndex === index ? null : index;
      this.#syncAllSteps();
    };

    #onStepNext = (event) => {
      const nextIndex = Number(event.detail.stepIndex) + 1;
      if (nextIndex < this.#steps.length) {
        this.#activeStepIndex = nextIndex;
      } else {
        // Last step "Next" — close all (merchant may re-label this "Review")
        this.#activeStepIndex = null;
      }
      this.#syncAllSteps();
      // Scroll the newly opened step into view on mobile
      if (this.#activeStepIndex !== null) {
        const targetStep = this.#steps[this.#activeStepIndex];
        if (targetStep) {
          targetStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };

    // ── Sync ──────────────────────────────────────────────────────────────

    #syncAllSteps() {
      this.#steps.forEach((step, index) => {
        const isOpen = index === this.#activeStepIndex;
        if (isOpen) {
          step.open();
        } else {
          step.close();
        }
      });
    }

    #syncAllCards() {
      this.querySelectorAll('bundle-product-card[data-product-id]').forEach((card) => {
        card.syncFromSelection(this.#selections.get(card.dataset.productId));
      });
      this.#syncAllStepCounts();
    }

    #syncAllStepCounts() {
      this.#steps.forEach((step) => {
        let selected = 0;
        step.querySelectorAll('bundle-product-card[data-product-id]').forEach((card) => {
          const selection = this.#selections.get(card.dataset.productId);
          if (!selection) return;
          const total = Object.values(selection.quantitiesByVariant).reduce((sum, quantity) => sum + quantity, 0);
          if (total > 0) selected++;
        });
        step.setSelectedCount(selected);
      });
    }

    // ── Public API (used by Phase 2+ sub-elements) ─────────────────────────

    /**
     * Called by <bundle-product-card> when a variant is selected.
     * @param {string} productId
     * @param {string} variantId
     */
    selectVariant(productId, variantId) {
      const current = this.#selections.get(productId);
      if (!current) return;
      this.#selections.set(productId, { ...current, activeVariantId: variantId });
      this.#syncAllCards();
      this.#dispatchStateChange();
    }

    /**
     * Increment the active variant's quantity for a product.
     * @param {string} productId
     * @param {string|null} variantId  Pass null for products without variants.
     */
    incrementQuantity(productId, variantId = null) {
      const current = this.#selections.get(productId);
      if (!current) return;
      const key = variantId ?? 'default';
      const qty = (current.quantitiesByVariant[key] ?? 0) + 1;
      this.#selections.set(productId, {
        ...current,
        quantitiesByVariant: { ...current.quantitiesByVariant, [key]: qty },
      });
      this.#updateStepCount(productId);
      this.#syncAllCards();
      this.#dispatchStateChange();
    }

    /**
     * Decrement the active variant's quantity, floored at 0.
     * @param {string} productId
     * @param {string|null} variantId
     */
    decrementQuantity(productId, variantId = null) {
      const current = this.#selections.get(productId);
      if (!current) return;
      const key = variantId ?? 'default';
      const current_qty = current.quantitiesByVariant[key] ?? 0;
      if (current_qty <= 0) return;
      this.#selections.set(productId, {
        ...current,
        quantitiesByVariant: { ...current.quantitiesByVariant, [key]: current_qty - 1 },
      });
      this.#updateStepCount(productId);
      this.#syncAllCards();
      this.#dispatchStateChange();
    }

    /**
     * Register a product's initial selection state (called by <bundle-product-card>
     * in Phase 2 on connectedCallback).
     * @param {string} productId
     * @param {Object} selectionInit  { activeVariantId, quantitiesByVariant }
     */
    registerProduct(productId, selectionInit) {
      if (!this.#selections.has(productId)) {
        this.#selections.set(productId, selectionInit);
        this.#dispatchStateChange();
      }
      this.#syncAllCards();
      queueMicrotask(() => this.#syncAllStepCounts());
    }

    /**
     * Get the current selection for a product.
     * @param {string} productId
     * @returns {Object|undefined}
     */
    getSelection(productId) {
      return this.#selections.get(productId);
    }

    getConfig() {
      return this.#config;
    }

    saveForLater() {
      try {
        window.localStorage.setItem(this.#storageKey(), JSON.stringify(this.getState()));
        return true;
      } catch (error) {
        console.warn('[bundle-builder] Saved state could not be stored.', error);
        return false;
      }
    }

    /**
    * Full state snapshot used by Save for later and future persistence flows.
     * @returns {Object}
     */
    getState() {
      return {
        activeStepIndex: this.#activeStepIndex,
        selections: Object.fromEntries(this.#selections),
      };
    }

    /**
     * Restore state from a previously saved snapshot.
     * @param {Object} state
     */
    restoreState(state) {
      if (typeof state.activeStepIndex === 'number') {
        this.#activeStepIndex = state.activeStepIndex;
      }
      if (state.selections && typeof state.selections === 'object') {
        for (const [id, sel] of Object.entries(state.selections)) {
          this.#selections.set(id, sel);
        }
      }
      this.#syncAllSteps();
      this.#dispatchStateChange();
    }

    // ── Internal helpers ───────────────────────────────────────────────────

    /**
     * After a quantity change, update the selected-count badge on the owning step.
     * A product is "selected" if any variant has qty > 0.
     */
    #updateStepCount(productId) {
      // Find which step owns this product by looking at the card's data attribute
      const card = this.querySelector(`[data-product-id="${productId}"]`);
      if (!card) return;
      const stepEl = card.closest('bundle-step');
      if (!stepEl) return;

      // Count selected products in this step
      const allCards = stepEl.querySelectorAll('bundle-product-card[data-product-id]');
      let selected = 0;
      allCards.forEach((c) => {
        const pid = c.dataset.productId;
        const sel = this.#selections.get(pid);
        if (!sel) return;
        const total = Object.values(sel.quantitiesByVariant).reduce((s, q) => s + q, 0);
        if (total > 0) selected++;
      });

      stepEl.setSelectedCount(selected);
    }

    /**
     * Fires a custom event so the review panel (and any other listener) can react.
     */
    #dispatchStateChange() {
      this.dispatchEvent(new CustomEvent('bb:state-change', {
        bubbles: true,
        detail: { state: this.getState() },
      }));
    }
  });
}

if (!customElements.get('bundle-product-card')) {
  customElements.define('bundle-product-card', class BundleProductCard extends HTMLElement {
    #builder = null;
    #variantSelector = null;
    #quantityStepper = null;

    async connectedCallback() {
      await Promise.all([
        customElements.whenDefined('bundle-variant-selector'),
        customElements.whenDefined('bundle-quantity-stepper'),
      ]);
      if (!this.isConnected || this.#builder) return;

      this.#builder = this.closest('bundle-builder');
      this.#variantSelector = this.querySelector('bundle-variant-selector');
      this.#quantityStepper = this.querySelector('bundle-quantity-stepper');

      if (!this.#builder) return;

      this.#builder.addEventListener('bb:state-change', this.#onBuilderStateChange);

      const hasVariants = this.dataset.hasVariants === 'true';
      this.#builder.registerProduct(this.dataset.productId, {
        activeVariantId: hasVariants ? this.dataset.defaultVariantId : null,
        quantitiesByVariant: hasVariants ? this.#getVariantQuantities() : { default: 0 },
      });

      this.#variantSelector?.addEventListener('bb:variant-select', this.#onVariantSelect);
      this.#quantityStepper?.addEventListener('bb:quantity-change', this.#onQuantityChange);
      this.syncFromSelection(this.#builder.getSelection(this.dataset.productId));
    }

    disconnectedCallback() {
      this.#builder?.removeEventListener('bb:state-change', this.#onBuilderStateChange);
      this.#variantSelector?.removeEventListener('bb:variant-select', this.#onVariantSelect);
      this.#quantityStepper?.removeEventListener('bb:quantity-change', this.#onQuantityChange);
    }

    #onBuilderStateChange = () => {
      this.syncFromSelection(this.#builder?.getSelection(this.dataset.productId));
    };

    syncFromSelection(selection) {
      if (!selection) return;

      this.#variantSelector?.syncActiveVariant(selection.activeVariantId);
      const variantId = selection.activeVariantId ?? 'default';
      const option = this.#variantSelector?.getOption(variantId);
      const quantity = selection.quantitiesByVariant[variantId] ?? 0;
      const totalQuantity = Object.values(selection.quantitiesByVariant).reduce((total, value) => total + value, 0);
      this.dataset.selected = String(totalQuantity > 0);
      this.#quantityStepper?.syncQuantity(quantity, option?.dataset.available !== 'false');
      this.#syncPrice(option);
    }

    #getVariantQuantities() {
      const quantities = {};
      this.#variantSelector?.options.forEach((option) => {
        quantities[option.dataset.variantId] = 0;
      });
      return quantities;
    }

    #syncPrice(option) {
      if (!option) return;
      const currentPrice = this.querySelector('.bb-product-card__current-price');
      const comparePrice = this.querySelector('.bb-product-card__compare-price');
      if (currentPrice) currentPrice.textContent = option.dataset.price;
      if (comparePrice) {
        comparePrice.textContent = option.dataset.compareAtPrice;
        comparePrice.hidden = !option.dataset.compareAtPrice;
      }
    }

    #onVariantSelect = (event) => {
      this.#builder?.selectVariant(this.dataset.productId, event.detail.variantId);
    };

    #onQuantityChange = (event) => {
      const variantId = this.dataset.hasVariants === 'true'
        ? this.#builder?.getSelection(this.dataset.productId)?.activeVariantId
        : null;
      if (event.detail.action === 'increment') {
        this.#builder?.incrementQuantity(this.dataset.productId, variantId);
      } else {
        this.#builder?.decrementQuantity(this.dataset.productId, variantId);
      }
    };
  });
}

if (!customElements.get('bundle-variant-selector')) {
  customElements.define('bundle-variant-selector', class BundleVariantSelector extends HTMLElement {
    #options = [];

    connectedCallback() {
      this.#options = Array.from(this.querySelectorAll('.bb-variant-selector__option'));
      this.#options.forEach((option) => option.addEventListener('click', this.#onOptionClick));
    }

    disconnectedCallback() {
      this.#options.forEach((option) => option.removeEventListener('click', this.#onOptionClick));
    }

    get options() {
      return this.#options;
    }

    getOption(variantId) {
      return this.#options.find((option) => option.dataset.variantId === String(variantId));
    }

    syncActiveVariant(activeVariantId) {
      this.#options.forEach((option) => {
        option.setAttribute('aria-pressed', String(option.dataset.variantId === activeVariantId));
      });
    }

    #onOptionClick = (event) => {
      this.dispatchEvent(new CustomEvent('bb:variant-select', {
        bubbles: true,
        detail: { variantId: event.currentTarget.dataset.variantId },
      }));
    };
  });
}

if (!customElements.get('bundle-quantity-stepper')) {
  customElements.define('bundle-quantity-stepper', class BundleQuantityStepper extends HTMLElement {
    #decreaseButton = null;
    #increaseButton = null;
    #output = null;

    connectedCallback() {
      this.#decreaseButton = this.querySelector('.bb-quantity-stepper__button--decrease');
      this.#increaseButton = this.querySelector('.bb-quantity-stepper__button--increase');
      this.#output = this.querySelector('.bb-quantity-stepper__value');

      this.#decreaseButton?.addEventListener('click', this.#onDecrease);
      this.#increaseButton?.addEventListener('click', this.#onIncrease);
      this.#setGlyphs();
      this.#setLabels();
      this.syncQuantity(Number(this.dataset.quantity ?? 0), this.dataset.available !== 'false');
    }

    disconnectedCallback() {
      this.#decreaseButton?.removeEventListener('click', this.#onDecrease);
      this.#increaseButton?.removeEventListener('click', this.#onIncrease);
    }

    syncQuantity(quantity, available = true) {
      if (this.#output) {
        this.#output.textContent = String(quantity);
      }
      if (this.#decreaseButton) {
        this.#decreaseButton.disabled = quantity <= 0;
      }
      if (this.#increaseButton) {
        this.#increaseButton.disabled = !available;
      }
      const label = (this.dataset.quantityLabel ?? '').replace(/\d+|\{\{\s*count\s*\}\}/, String(quantity));
      if (label) this.setAttribute('aria-label', label);
    }

    #setLabels() {
      if (this.#decreaseButton) this.#decreaseButton.setAttribute('aria-label', this.dataset.decreaseLabel ?? '');
      if (this.#increaseButton) this.#increaseButton.setAttribute('aria-label', this.dataset.increaseLabel ?? '');
    }

    #setGlyphs() {
      const minus = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      minus.setAttribute('viewBox', '0 0 8 2');
      minus.setAttribute('aria-hidden', 'true');
      minus.setAttribute('focusable', 'false');
      minus.innerHTML = '<path d="M0 1H8"/>';

      const plus = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      plus.setAttribute('viewBox', '0 0 8 8');
      plus.setAttribute('aria-hidden', 'true');
      plus.setAttribute('focusable', 'false');
      plus.innerHTML = '<path d="M4 0V8M0 4H8"/>';

      if (this.#decreaseButton) this.#decreaseButton.replaceChildren(minus);
      if (this.#increaseButton) this.#increaseButton.replaceChildren(plus);
    }

    #onDecrease = () => {
      this.dispatchEvent(new CustomEvent('bb:quantity-change', {
        bubbles: true,
        detail: {
          action: 'decrement',
          productId: this.dataset.productId,
          variantId: this.dataset.variantId || null,
        },
      }));
    };

    #onIncrease = () => {
      this.dispatchEvent(new CustomEvent('bb:quantity-change', {
        bubbles: true,
        detail: {
          action: 'increment',
          productId: this.dataset.productId,
          variantId: this.dataset.variantId || null,
        },
      }));
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. <bundle-step> — accordion step
// ─────────────────────────────────────────────────────────────────────────────

if (!customElements.get('bundle-step')) {
  customElements.define('bundle-step', class BundleStep extends HTMLElement {

    /** @type {HTMLButtonElement|null} */
    #headerBtn = null;

    /** @type {HTMLElement|null} */
    #contentPanel = null;

    /** @type {HTMLElement|null} */
    #countBadge = null;

    /** @type {HTMLButtonElement|null} */
    #nextBtn = null;

    // ── Lifecycle ──────────────────────────────────────────────────────────

    connectedCallback() {
      this.#headerBtn    = this.querySelector('.bb-step__header');
      this.#contentPanel = this.querySelector('.bb-step__content');
      this.#countBadge   = this.querySelector('.bb-step__count');
      this.#nextBtn      = this.querySelector('.bb-step__next');

      this.#headerBtn?.addEventListener('click', this.#onHeaderClick);
      this.#nextBtn?.addEventListener('click', this.#onNextClick);
    }

    disconnectedCallback() {
      this.#headerBtn?.removeEventListener('click', this.#onHeaderClick);
      this.#nextBtn?.removeEventListener('click', this.#onNextClick);
    }

    // ── Event handlers ─────────────────────────────────────────────────────

    #onHeaderClick = () => {
      this.dispatchEvent(new CustomEvent('bb:step-toggle', {
        bubbles: true,
        detail: { stepIndex: Number(this.dataset.stepIndex) },
      }));
    };

    #onNextClick = () => {
      this.dispatchEvent(new CustomEvent('bb:step-next', {
        bubbles: true,
        detail: { stepIndex: Number(this.dataset.stepIndex) },
      }));
    };

    // ── Public API ─────────────────────────────────────────────────────────

    open() {
      if (!this.#headerBtn || !this.#contentPanel) return;
      this.#headerBtn.setAttribute('aria-expanded', 'true');
      this.#contentPanel.removeAttribute('hidden');
      this.classList.add('bb-step--open');
    }

    close() {
      if (!this.#headerBtn || !this.#contentPanel) return;
      this.#headerBtn.setAttribute('aria-expanded', 'false');
      this.#contentPanel.setAttribute('hidden', '');
      this.classList.remove('bb-step--open');
    }

    /**
     * Update the "N selected" badge text.
     * Liquid pre-rendered the label; we just replace the count number here.
     * The config block carries a resolved "selected" string for localisation.
     * @param {number} count
     */
    setSelectedCount(count) {
      if (!this.#countBadge) return;
      // Fetch the localised pattern from the root builder's config if available
      const builder = this.closest('bundle-builder');
      const selectedLabel = builder
        ? this.#getSelectedLabel(builder, count)
        : `${count} selected`;
      this.#countBadge.textContent = selectedLabel;
    }

    // ── Internal helpers ───────────────────────────────────────────────────

    #getSelectedLabel(builder, count) {
      // The builder exposes the config; we can read it via a data attribute or
      // look it up on the element itself. For now use the server-rendered text
      // as the pattern and replace only the count digit.
      // Phase 2 will wire in the full localised plural form from config.settings.
      const currentText = this.#countBadge.textContent.trim();
      // Pattern: "0 selected" → replace leading digit(s) with new count
      return currentText.replace(/^\d+/, String(count));
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. <bundle-review-panel> — review panel shell (Phase 3 completes this)
// ─────────────────────────────────────────────────────────────────────────────

if (!customElements.get('bundle-review-panel')) {
  customElements.define('bundle-review-panel', class BundleReviewPanel extends HTMLElement {

    /** @type {BundleBuilder|null} */
    #builder = null;

    connectedCallback() {
      this.#builder = this.closest('bundle-builder');
      if (!this.#builder) return;
      this.#builder.addEventListener('bb:state-change', this.#onStateChange);
      queueMicrotask(() => this.#render());
    }

    disconnectedCallback() {
      this.#builder?.removeEventListener('bb:state-change', this.#onStateChange);
    }

    #onStateChange = (event) => {
      this.#render(event.detail.state);
    };

    #onReviewQuantityChange = (event) => {
      event.stopPropagation();
      const { productId, variantId, action } = event.detail;
      if (action === 'increment') {
        this.#builder?.incrementQuantity(productId, variantId);
      } else {
        this.#builder?.decrementQuantity(productId, variantId);
      }
    };

    #onSaveForLater = (event) => {
      event.preventDefault();
      const saved = this.#builder?.saveForLater();
      const status = this.querySelector('.bb-review__save-status');
      if (saved && status) {
        status.textContent = this.#builder.getConfig()?.settings.savedLabel ?? '';
      }
    };

    #onCheckout = async (event) => {
      event.preventDefault();
      const checkoutBtn = event.currentTarget;
      if (checkoutBtn.disabled) return;

      const state = this.#builder?.getState();
      const config = this.#builder?.getConfig();
      if (!state || !config) return;

      const lines = [];
      for (const step of config.steps ?? []) {
        const stepElement = this.#builder.querySelector(`bundle-step[data-block-id="${step.blockId}"]`);
        if (!stepElement) continue;
        lines.push(...this.#getLines(stepElement, state));
      }

      const activeLines = lines.filter((line) => line.quantity > 0 && line.variantId);
      if (activeLines.length === 0) return;

      const originalText = checkoutBtn.textContent;
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = 'Processing...';

      const root = window.Shopify?.routes?.root || '/';

      try {
        if (window.Cart?.add) {
          const formData = new FormData();
          activeLines.forEach((line, index) => {
            formData.append(`items[${index}][id]`, line.variantId);
            formData.append(`items[${index}][quantity]`, line.quantity);
          });
          await window.Cart.add(formData, checkoutBtn);
        } else {
          const items = activeLines.map((line) => ({
            id: line.variantId,
            quantity: line.quantity,
          }));
          const response = await fetch(`${root}cart/add.js`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ items }),
          });
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.description || errorData.message || 'Failed to add bundle to cart');
          }
        }

        window.location.href = `${root}checkout`;
      } catch (error) {
        console.error('[bundle-builder] Checkout error:', error);
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = originalText;

        const status = this.querySelector('.bb-review__save-status');
        if (status) {
          status.textContent = error.description || error.message || 'Error proceeding to checkout. Please try again.';
        }
      }
    };

    #render(state = this.#builder?.getState()) {
      const groupsContainer = this.querySelector('.bb-review__groups');
      const config = this.#builder?.getConfig();
      if (!groupsContainer || !config || !state) return;

      const groups = [];
      for (const step of config.steps ?? []) {
        const stepElement = this.#builder.querySelector(`bundle-step[data-block-id="${step.blockId}"]`);
        if (!stepElement) continue;
        const lines = this.#getLines(stepElement, state);
        groups.push({ title: step.reviewSubheading, lines });
      }

      const totals = groups.flatMap((group) => group.lines).reduce(
        (summary, line) => ({
          subtotal: summary.subtotal + line.priceCents * line.quantity,
          originalSubtotal: summary.originalSubtotal + line.compareAtPriceCents * line.quantity,
        }),
        { subtotal: 0, originalSubtotal: 0 },
      );
      const savings = Math.max(0, totals.originalSubtotal - totals.subtotal);
      const monthly = totals.subtotal / 12;
      groupsContainer.innerHTML = `${groups.map((group) => this.#renderGroup(group, config)).join('')}${this.#renderShipping(config)}${this.#renderSummary(config, totals, savings, monthly)}`;

      groupsContainer.querySelectorAll('bundle-quantity-stepper').forEach((stepper) => {
        stepper.addEventListener('bb:quantity-change', this.#onReviewQuantityChange);
      });
      groupsContainer.querySelector('.bb-review__save')?.addEventListener('click', this.#onSaveForLater);

      const checkoutBtn = groupsContainer.querySelector('.bb-review__checkout');
      if (checkoutBtn) {
        const totalItems = groups.flatMap((group) => group.lines).reduce((sum, line) => sum + line.quantity, 0);
        checkoutBtn.disabled = totalItems === 0;
        checkoutBtn.addEventListener('click', this.#onCheckout);
      }
    }

    #getLines(stepElement, state) {
      const lines = [];
      stepElement.querySelectorAll('bundle-product-card[data-product-id]').forEach((card) => {
        const selection = state.selections[card.dataset.productId];
        if (!selection) return;

        const options = card.querySelectorAll('.bb-variant-selector__option');
        const variants = options.length ? Array.from(options) : [null];
        for (const option of variants) {
          const key = option?.dataset.variantId ?? 'default';
          const variantId = option?.dataset.variantId || card.dataset.defaultVariantId;
          const quantity = selection.quantitiesByVariant[key] ?? 0;
          if (quantity <= 0) continue;
          lines.push({
            productId: card.dataset.productId,
            variantId,
            title: card.dataset.productTitle,
            variantTitle: option?.dataset.variantTitle ?? '',
            image: option?.dataset.variantImage || card.dataset.productImage,
            priceCents: Number(option?.dataset.priceCents ?? card.dataset.priceCents ?? 0),
            compareAtPriceCents: Number(option?.dataset.compareAtPriceCents ?? card.dataset.compareAtPriceCents ?? 0),
            quantity,
          });
        }
      });
      return lines;
    }

    #renderGroup(group, config) {
      return `<section class="bb-review__group"><h3 class="bb-review__group-title">${this.#escape(group.title)}</h3><div class="bb-review__items">${group.lines.map((line) => this.#renderLine(line, config)).join('')}</div></section>`;
    }

    #renderLine(line, config) {
      const compare = line.compareAtPriceCents > line.priceCents
        ? `<s class="bb-review__compare-price">${this.#formatMoney(line.compareAtPriceCents * line.quantity, config)}</s>`
        : '';
      const variant = line.variantTitle && line.variantTitle !== 'Default Title'
        ? `<span class="bb-review__variant">${this.#escape(line.variantTitle)}</span>`
        : '';
      const quantityLabel = config.settings.quantityLabel.replace('{{ count }}', String(line.quantity));
      return `<div class="bb-review__line"><div class="bb-review__line-main"><div class="bb-review__thumbnail">${line.image ? `<img src="${this.#escape(line.image)}" alt="" aria-hidden="true" width="41" height="41">` : ''}</div><div class="bb-review__line-copy"><span class="bb-review__line-title">${this.#escape(line.title)}</span>${variant}</div><bundle-quantity-stepper class="bb-review__stepper" data-product-id="${this.#escape(line.productId)}" data-variant-id="${this.#escape(line.variantId)}" data-quantity="${line.quantity}" data-quantity-label="${this.#escape(quantityLabel)}" data-decrease-label="${this.#escape(config.settings.decreaseQtyLabel)}" data-increase-label="${this.#escape(config.settings.increaseQtyLabel)}" data-available="true" role="group" aria-label="${this.#escape(quantityLabel)}"><button type="button" class="bb-quantity-stepper__button bb-quantity-stepper__button--decrease"><span aria-hidden="true">−</span></button><output class="bb-quantity-stepper__value" aria-live="polite">${line.quantity}</output><button type="button" class="bb-quantity-stepper__button bb-quantity-stepper__button--increase"><span aria-hidden="true">+</span></button></bundle-quantity-stepper></div><div class="bb-review__line-price">${compare}<span>${line.priceCents === 0 ? this.#escape(config.settings.freeLabel) : this.#formatMoney(line.priceCents * line.quantity, config)}</span></div></div>`;
    }

    #renderShipping(config) {
      return `<section class="bb-review__shipping"><div class="bb-review__shipping-copy"><span class="bb-review__shipping-icon"><img src="${this.#escape(config.settings.shippingIconUrl)}" alt="" aria-hidden="true" width="29" height="29"></span><span>${this.#escape(config.settings.shippingLabel)}</span></div><div class="bb-review__line-price"><s class="bb-review__compare-price">${this.#escape(config.settings.shippingOriginalPrice)}</s><span>${this.#escape(config.settings.freeLabel)}</span></div></section>`;
    }

    #renderSummary(config, totals, savings, monthly) {
      const financingTemplate = this.#builder.dataset.financingText || config.settings.financingTemplate;
      const financing = financingTemplate.replace(/\{\{?\s*price\s*\}?\}/, this.#formatMoney(monthly, config));
      const savingsText = config.settings.savingsTemplate.replace('{{ amount }}', this.#formatMoney(savings, config));
      const guarantee = this.#builder.dataset.guaranteeText;
      return `<section class="bb-review__summary"><div class="bb-review__guarantee"><img class="bb-review__guarantee-badge" src="${this.#escape(config.settings.guaranteeBadgeUrl)}" alt="${this.#escape(guarantee)}" width="78" height="78"><span>${this.#escape(guarantee)}</span></div><div class="bb-review__summary-row"><span class="bb-review__financing">${this.#escape(financing)}</span><div class="bb-review__totals">${totals.originalSubtotal > totals.subtotal ? `<s class="bb-review__compare-price">${this.#formatMoney(totals.originalSubtotal, config)}</s>` : ''}<strong>${this.#formatMoney(totals.subtotal, config)}</strong></div></div><p class="bb-review__savings">${this.#escape(savingsText)}</p><button type="button" class="bb-review__checkout">${this.#escape(this.#builder.dataset.checkoutLabel)}</button><a class="bb-review__save" href="#">${this.#escape(this.#builder.dataset.saveLabel)}</a><span class="bb-review__save-status" aria-live="polite"></span></section>`;
    }

    #formatMoney(cents, config) {
      return new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: config.currencyCode || 'USD' }).format(cents / 100);
    }

    #escape(value = '') {
      return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
    };
  });
}
