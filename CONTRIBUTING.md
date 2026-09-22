# Contributing to BaseTheme

Thank you for your interest in contributing to BaseTheme! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

* Use a clear and descriptive title
* Describe the exact steps to reproduce the problem
* Describe the behavior you observed and what behavior you expected
* Include screenshots if possible
* Include your environment details (OS, browser, etc.)

### Suggesting Enhancements

If you have ideas for new features or improvements:

* Use a clear and descriptive title
* Provide a detailed description of the proposed enhancement
* Explain why this enhancement would be useful
* List any additional context or screenshots

### Pull Requests

1. Fork the repository
2. Create a new branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add some amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Development Setup

1. Install the Shopify CLI
2. Clone the repository
3. Run `npm install` to install dependencies
4. Create a new theme in your development store
5. Run `shopify theme serve` to start development

### Coding Standards

* Follow the existing code style
* Write clear, readable, and maintainable code
* Comment your code when necessary
* Update documentation if needed

### Commit Messages

* Use clear and meaningful commit messages
* Start with a verb in the present tense
* Keep the first line under 72 characters
* Reference issues and pull requests when relevant

Example:
```
Add cart drawer Alpine.js implementation
```

## Project Structure

```
├── assets/
│   ├── *.js         # JavaScript files
│   └── *.css        # CSS files
├── sections/        # Theme sections
├── snippets/        # Reusable liquid snippets
├── templates/       # Page templates
└── config/         # Theme settings
```

## Need Help?

If you need help with anything, feel free to:

* Check the documentation
* Open an issue with your question
* Reach out to the maintainers

## License

By contributing to BaseTheme, you agree that your contributions will be licensed under the [MIT License](LICENSE). 