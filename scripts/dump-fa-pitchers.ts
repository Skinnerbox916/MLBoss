import { redisUtils } from '../src/lib/redis';

async function dumpCache() {
  try {
    const keys = await redisUtils.keys('cache:semi-dynamic:fa-pitchers:*');
    console.log('Found keys:', keys);
    if (keys.length === 0) return;

    const key = keys[0];
    console.log('Dumping key:', key);
    const data = await redisUtils.get(key);
    if (!data) {
      console.log('No data found for key');
      return;
    }

    const players = JSON.parse(data);
    console.log(`Total players in cache: ${players.length}`);
    
    console.log('\nFirst 20 players:');
    players.slice(0, 20).forEach((p, i) => {
      console.log(`${i+1}. ${p.name} (ID: ${p.player_id}) [${p.display_position}] - Status: ${p.status || 'Active'} - Ownership: ${p.ownership_type}`);
    });

    const musgrove = players.find(p => p.name.includes('Musgrove'));
    console.log('\nJoe Musgrove:', musgrove ? JSON.stringify(musgrove, null, 2) : 'Not found');

    const suter = players.find(p => p.name.includes('Suter'));
    console.log('Brent Suter:', suter ? JSON.stringify(suter, null, 2) : 'Not found');

    const early = players.find(p => p.name.includes('Early'));
    console.log('Connor Early:', early ? JSON.stringify(early, null, 2) : 'Not found');

    const chandler = players.find(p => p.name.includes('Chandler'));
    console.log('Bubba Chandler:', chandler ? JSON.stringify(chandler, null, 2) : 'Not found');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

dumpCache();
