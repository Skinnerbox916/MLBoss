const { readdirSync, readFileSync, writeFileSync, statSync } = require('fs');
const path = require('path');

/**
 * Extract title and description from markdown file.
 */
function parseMarkdownMeta(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  // Find title (first # heading)
  const titleLine = lines.find(line => line.startsWith('# '));
  const title = titleLine ? titleLine.replace(/^#\s*/, '').trim() : path.basename(filePath, '.md');
  
  // Find description (first non-empty line after title that's not a heading or link)
  let description = '';
  let foundTitle = false;
  
  for (const line of lines) {
    if (line.startsWith('# ')) {
      foundTitle = true;
      continue;
    }
    
    if (foundTitle && line.trim() && 
        !line.startsWith('#') && 
        !line.startsWith('➜') && 
        !line.startsWith('>') &&
        !line.startsWith('```')) {
      description = line.trim();
      break;
    }
  }
  
  return { title, description: description || 'No description available' };
}

/**
 * Recursively walk directory and collect markdown files.
 */
function walkDocs(dir, baseDir, docs) {
  const items = readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    
    if (item.isDirectory()) {
      walkDocs(fullPath, baseDir, docs);
    } else if (item.name.endsWith('.md')) {
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const key = relativePath.replace(/\.md$/, '');
      const stats = statSync(fullPath);
      const { title, description } = parseMarkdownMeta(fullPath);
      
      docs[key] = {
        path: relativePath,
        title,
        description,
        lastModified: stats.mtime.toISOString()
      };
    }
  }
}

/**
 * Generate documentation index files.
 */
function generateDocsIndex() {
  const docsDir = path.join(process.cwd(), 'docs');
  const docs = {};
  
  // Walk docs directory
  walkDocs(docsDir, docsDir, docs);
  
  // Generate JSON index
  const jsonIndex = {
    generated: new Date().toISOString(),
    baseDir: 'docs',
    count: Object.keys(docs).length,
    docs
  };
  
  writeFileSync(
    path.join(docsDir, 'index.json'), 
    JSON.stringify(jsonIndex, null, 2)
  );
  
  // Generate simple key-description map for quick lookup
  const simpleIndex = {};
  for (const [key, entry] of Object.entries(docs)) {
    simpleIndex[key] = entry.description;
  }
  
  writeFileSync(
    path.join(docsDir, 'index-simple.json'),
    JSON.stringify(simpleIndex, null, 2)
  );
  
  console.log(`Generated documentation index with ${Object.keys(docs).length} files:`);
  for (const [key, entry] of Object.entries(docs)) {
    console.log(`  ${key} - ${entry.title}`);
  }
}

// Run if called directly
if (require.main === module) {
  generateDocsIndex();
}

module.exports = { generateDocsIndex }; 