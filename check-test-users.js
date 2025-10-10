const db = require('./src/config/database');

async function checkUsers() {
  try {
    console.log('\n🔍 Checking for test users...\n');
    
    const result = await db.query('SELECT id, email, company_name, role, is_active FROM companies LIMIT 10');
    
    if (result.rows.length === 0) {
      console.log('❌ No users found in database.');
      console.log('\n💡 You need to create a test user first.');
      console.log('   Check if there are scripts like: create-test-user.js\n');
    } else {
      console.log(`✅ Found ${result.rows.length} user(s):\n`);
      console.table(result.rows);
      
      console.log('\n💡 To login, use the email as username:');
      console.log('   curl -X POST http://localhost:3333/api/companies/login \\');
      console.log('     -H "Content-Type: application/json" \\');
      console.log(`     -d '{"username":"${result.rows[0].email}","password":"YOUR_PASSWORD"}'\n`);
      console.log('   Or test interactively:');
      console.log('   node test-xero-connection-localhost.js\n');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkUsers();

