#!/bin/bash

# Script to fix screenshot filenames for Claude to read
cd /Volumes/EncryptDisk/CC_Manager/manager-work/screenshots/

for file in *.png; do
    # Remove special characters and create clean filename
    newname=$(echo "$file" | sed 's/[^a-zA-Z0-9._-]/_/g' | sed 's/__*/_/g')
    if [ "$file" != "$newname" ]; then
        mv "$file" "$newname"
        echo "Renamed: $file -> $newname"
    fi
done

echo "Done! Files renamed:"
ls -la
