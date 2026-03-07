#!/bin/bash
set -e

VERSION=$(node -p "require('./package.json').version")

echo ""
echo "  Publishing @cmer/localhook v$VERSION"
echo ""

# Preflight checks
if [ -n "$(git status --porcelain)" ]; then
  echo "  ERROR: Working tree is dirty. Commit or stash changes first."
  exit 1
fi

echo "  Running preflight..."
node cli.js --help > /dev/null 2>&1
echo "  CLI works."
echo ""

read -p "  Publish v$VERSION to npm? (y/N) " confirm
if [ "$confirm" != "y" ]; then
  echo "  Aborted."
  exit 0
fi

npm publish --access public

git tag "v$VERSION"
git push --tags

echo ""
echo "  Published v$VERSION and tagged on GitHub!"
echo "  Run: npx @cmer/localhook"
echo ""
