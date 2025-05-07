/**
 * Script to fetch probable pitchers from MLB.com
 * 
 * Run with: node scripts/fetch-probable-pitchers.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Format date as YYYY-MM-DD
const formatDate = (date) => {
  return date.toISOString().split('T')[0];
};

// Today's date
const today = new Date();
const dateString = formatDate(today);

// URL for MLB probable pitchers (you can change the date in the URL)
const url = `https://www.mlb.com/probable-pitchers/${dateString}`;

console.log(`Fetching probable pitchers for ${dateString}...`);

// If MLB.com scraping fails, use a fallback list of current probable pitchers
// Update this as needed with reliable data from sports sites
const fallbackPitchers = [
  "Zack Wheeler",
  "Drew Rasmussen",
  "Michael King",
  "Paul Skenes", 
  "Pablo López",
  "Zac Gallen",
  "Justin Verlander",
  "David Peterson",
  "Chase Dollander",
  "Spencer Arrighetti",
  "Sean Burke",
  "Hayden Wesneski",
  "Jackson Jobe",
  "Luis L. Ortiz"
];

https.get(url, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`Received response from MLB.com (status: ${res.statusCode})`);
    
    // Try several different patterns to extract pitcher names
    let pitchers = [];
    
    // Method 1: Look for pitcher names in specific HTML pattern
    const pitcherMatches1 = data.match(/<div[^>]*>([^<]+)<\/div>\s*<div[^>]*>RHP|LHP/g) || [];
    if (pitcherMatches1.length > 0) {
      pitchers = pitcherMatches1.map(match => {
        const nameMatch = match.match(/>([^<]+)</);
        return nameMatch ? nameMatch[1].trim() : null;
      }).filter(Boolean);
      console.log('Found pitchers using method 1:', pitchers.length);
    }
    
    // Method 2: Look for more generic pitcher patterns if method 1 failed
    if (pitchers.length === 0) {
      const pitcherMatches2 = data.match(/pitcher-name[^>]*>([^<]+)<\/span>/g) || [];
      pitchers = pitcherMatches2.map(match => {
        const nameMatch = match.match(/>([^<]+)</);
        return nameMatch ? nameMatch[1].trim() : null;
      }).filter(Boolean);
      console.log('Found pitchers using method 2:', pitchers.length);
    }
    
    // Method 3: Another pattern that might work
    if (pitchers.length === 0) {
      const pitcherMatches3 = data.match(/<a[^>]*href="\/player\/[^>]*>([^<]+)<\/a>/g) || [];
      pitchers = pitcherMatches3.map(match => {
        const nameMatch = match.match(/>([^<]+)</);
        return nameMatch ? nameMatch[1].trim() : null;
      }).filter(Boolean);
      console.log('Found pitchers using method 3:', pitchers.length);
    }
    
    // If we still don't have any pitchers, use the fallback list
    if (pitchers.length === 0) {
      console.log('No pitchers found by scraping. Using fallback list.');
      pitchers = fallbackPitchers;
    }
    
    console.log('Found probable pitchers:');
    pitchers.forEach(pitcher => console.log(` - ${pitcher}`));
    
    // Create the output file path
    const outputPath = path.join(__dirname, '..', 'data', 'probable-pitchers.json');
    
    // Ensure the directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Save the pitchers to a JSON file
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ 
        date: dateString,
        pitchers,
        fetched_at: new Date().toISOString()
      }, null, 2)
    );
    
    console.log(`Saved ${pitchers.length} pitchers to ${outputPath}`);
  });
}).on('error', (err) => {
  console.error('Error fetching data:', err.message);
  
  // If there's an error, use the fallback list
  console.log('Using fallback list due to network error.');
  
  // Create the output file path
  const outputPath = path.join(__dirname, '..', 'data', 'probable-pitchers.json');
  
  // Ensure the directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Save the fallback pitchers to a JSON file
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ 
      date: dateString,
      pitchers: fallbackPitchers,
      fetched_at: new Date().toISOString()
    }, null, 2)
  );
  
  console.log(`Saved ${fallbackPitchers.length} fallback pitchers to ${outputPath}`);
}); 