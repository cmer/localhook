#!/bin/bash
set -e

CURRENT=$(node -p "require('./package.json').version")

echo ""
echo "  Current version: $CURRENT"
echo ""
echo "  1) patch  (bug fixes)"
echo "  2) minor  (new features)"
echo "  3) major  (breaking changes)"
echo ""

read -p "  Select (1/2/3): " choice

case $choice in
  1) TYPE="patch" ;;
  2) TYPE="minor" ;;
  3) TYPE="major" ;;
  *) echo "  Invalid choice."; exit 1 ;;
esac

NEW=$(npm version $TYPE --no-git-tag-version)

echo ""
echo "  Bumped $CURRENT -> $NEW"
echo ""
echo "  Next steps:"
echo "    1. Update CHANGELOG.md"
echo "    2. git add -A && git commit -m \"$NEW\""
echo "    3. git tag $NEW"
echo "    4. git push && git push --tags"
echo "    5. ./scripts/publish.sh"
echo ""
