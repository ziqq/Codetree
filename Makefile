SHELL   :=/bin/bash -e -o pipefail
PWD     :=$(shell pwd)
VERSION :=$(shell node -p "require('./src/manifest.json').version")
ZIP     :=dist/code-tree-$(VERSION).zip

.DEFAULT_GOAL := all
.PHONY: all
all: ## build pipeline
all: get verify

.PHONY: ci
ci: ## CI build pipeline
ci: get verify audit actionlint whitespace

.PHONY: precommit
precommit: ## validate the branch before commit
precommit: verify whitespace

.PHONY: help
help: ## Help dialog
				@echo 'Usage: make <OPTIONS> ... <TARGETS>'
				@echo ''
				@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: version
version: ## Print the extension version
				@echo $(VERSION)

.PHONY: get
get: ## Install locked development tools
				@npm ci || (echo "¯\_(ツ)_/¯ Get dependencies error"; exit 1)

.PHONY: lint
lint: ## ESLint and CSS validation
				@npm run lint

.PHONY: fix
fix: ## Apply ESLint autofixes
				@npx eslint . --fix

.PHONY: test
test: ## Run regression tests
				@npm test

.PHONY: check
check: ## Lint, tests and repository checks
				@npm run check

.PHONY: build
build: ## Bundle src/ into the unpacked extension in build/
				@npm run build

.PHONY: package
package: ## Build the reproducible extension ZIP into dist/
				@npm run package

.PHONY: verify-package
verify-package: ## Verify the dist ZIP against the bundled build
				@python3 scripts/package.py --verify $(ZIP)

.PHONY: verify
verify: ## Run all checks and build the ZIP
				@npm run verify

.PHONY: audit
audit: ## Audit development dependencies
				@npm audit --audit-level=high

.PHONY: actionlint
actionlint: ## Lint GitHub Actions workflows (requires Go)
				@go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12

.PHONY: whitespace
whitespace: ## Check whitespace in the working tree
				@git diff --check
				@git diff --cached --check

.PHONY: clean
clean: ## Remove build output
				@rm -rf build dist scripts/__pycache__

.PHONY: tag
tag: ## Tag and push the manifest version, e.g. v0.3.0
				@if [ -n "$$(git status --porcelain)" ]; then echo "¯\_(ツ)_/¯ There are uncommitted changes"; exit 1; fi
				@git fetch --quiet origin
				@if [ "$$(git rev-list --count @{u}..HEAD)" != "0" ]; then echo "¯\_(ツ)_/¯ There are unpushed changes"; exit 1; fi
				@npm run --silent build > /dev/null
				@python3 scripts/package.py --tag v$(VERSION) --output "$$(mktemp -d)" > /dev/null
				@$(MAKE) --no-print-directory tag-add TAG=v$(VERSION)

.PHONY: tag-add
tag-add: ## Add TAG. E.g: make tag-add TAG=v0.3.0
				@if [ -z "$(TAG)" ]; then echo "¯\_(ツ)_/¯ TAG is not set"; exit 1; fi
				@echo ""
				@echo "START ADDING TAG: $(TAG)"
				@echo ""
				@git tag -a $(TAG) -m "Codetree $(patsubst v%,%,$(TAG))"
				@git push origin $(TAG)
				@echo ""
				@echo "CREATED AND PUSHED TAG $(TAG)"
				@echo ""

.PHONY: tag-remove
tag-remove: ## Delete TAG. E.g: make tag-remove TAG=v0.3.0
				@if [ -z "$(TAG)" ]; then echo "¯\_(ツ)_/¯ TAG is not set"; exit 1; fi
				@echo ""
				@echo "START REMOVING TAG: $(TAG)"
				@echo ""
				@git tag -d $(TAG)
				@git push origin --delete $(TAG)
				@echo ""
				@echo "DELETED TAG $(TAG) LOCALLY AND REMOTELY"
				@echo ""
