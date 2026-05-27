import { redisUtils } from '../src/lib/redis';

(async () => {
  const key = 'cache:semi-dynamic:fa-pitchers:469.l.108611';
  const data = await redisUtils.get(key);
  if (!data) {
    console.log('No data found');
    return;
  }
  const players = JSON.parse(data);
  console.log(`Total players: ${players.length}`);
  
  const slice = players.slice(0, 50);
  console.log('Top 50 Available Pitchers (Merge Order):');
  slice.forEach((p, i) => {
    console.log(`${i+1}. ${p.name} (${p.display_position}, ${p.editorial_team_abbr}) - ${p.ownership_type}`);
  });
  
  const early = players.find(p => p.name.includes('Early'));
  console.log('\nConnelly Early:', early ? 'Found at index ' + players.indexOf(early) : 'Not found');
  
  const chandler = players.find(p => p.name.includes('Chandler'));
  console.log('Bubba Chandler:', chandler ? 'Found at index ' + players.indexOf(chandler) : 'Not found');

  const suter = players.find(p => p.name.includes('Suter'));
  console.log('Brent Suter:', suter ? 'Found at index ' + players.indexOf(suter) : 'Not found');

  process.exit(0);
})();
