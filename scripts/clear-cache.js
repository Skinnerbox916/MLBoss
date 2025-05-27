/**
 * Script to clear Next.js webpack cache
 * Use this when encountering webpack cache errors
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Cache directories to clear
const cacheDirectories = [
    '.next/cache',
];

// Main function
async function clearCaches() {
    console.log('Clearing Next.js caches...');
    
    for (const dir of cacheDirectories) {
        const cachePath = path.join(process.cwd(), dir);
        
        if (fs.existsSync(cachePath)) {
            try {
                console.log(`Removing ${cachePath}...`);
                fs.rmSync(cachePath, { recursive: true, force: true });
                console.log(`Successfully removed ${cachePath}`);
            } catch (error) {
                console.error(`Error removing ${cachePath}:`, error);
            }
        } else {
            console.log(`Directory ${cachePath} does not exist, skipping.`);
        }
    }
    
    console.log('Next.js caches cleared.');
    console.log('You can now restart your development server with:');
    console.log('  npm run dev');
}

// Execute if run directly
if (require.main === module) {
    clearCaches()
        .then(() => console.log('Cache clearing completed'))
        .catch(error => {
            console.error('Error clearing caches:', error);
            process.exit(1);
        });
}

module.exports = { clearCaches }; 