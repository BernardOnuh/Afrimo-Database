// test/checkLencoBalance.js

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');

async function checkLencoBalance() {
  console.log('\n========== LENCO ACCOUNT CHECK ==========');
  console.log('LENCO_ACCOUNT_ID:', process.env.LENCO_ACCOUNT_ID || '❌ MISSING');
  console.log('LENCO_API_KEY:', process.env.LENCO_API_KEY ? '✅ Found' : '❌ MISSING');
  console.log('==========================================\n');

  try {
    // ---- Check account details ----
    console.log('🔄 Fetching Lenco account details...');
    const accountRes = await axios.get(
      `https://api.lenco.co/access/v1/accounts/${process.env.LENCO_ACCOUNT_ID}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.LENCO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('\n📨 Account Response:');
    console.log(JSON.stringify(accountRes.data, null, 2));

  } catch (accountError) {
    console.error('❌ Account fetch failed:', accountError.response?.data || accountError.message);

    // ---- Try fetching all accounts (in case account ID is wrong) ----
    console.log('\n🔄 Trying to list all accounts...');
    try {
      const allAccountsRes = await axios.get(
        'https://api.lenco.co/access/v1/accounts',
        {
          headers: {
            Authorization: `Bearer ${process.env.LENCO_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('\n📨 All Accounts:');
      console.log(JSON.stringify(allAccountsRes.data, null, 2));

      // Show summary
      if (allAccountsRes.data?.data) {
        const accounts = allAccountsRes.data.data;
        console.log('\n========== ACCOUNT SUMMARY ==========');
        accounts.forEach((acc, i) => {
          console.log(`\nAccount ${i + 1}:`);
          console.log(`  ID:       ${acc.id}`);
          console.log(`  Name:     ${acc.name}`);
          console.log(`  Balance:  ₦${Number(acc.balance).toLocaleString()}`);
          console.log(`  Status:   ${acc.status}`);
          console.log(`  Currency: ${acc.currency}`);
        });
        console.log('=====================================');
        console.log('\n💡 Copy the correct account ID above into your .env as LENCO_ACCOUNT_ID');
      }

    } catch (listError) {
      console.error('❌ List accounts failed:', listError.response?.data || listError.message);
    }
  }
}

checkLencoBalance();