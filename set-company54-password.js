#!/usr/bin/env node

const db = require('./src/config/database');
const bcrypt = require('bcryptjs');

async function setCompany54Password() {
  try {
    const password = 'password123';
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    console.log('🔐 Setting password for company 54...');
    
    const result = await db.query(
      'UPDATE companies SET password_hash = $1 WHERE id = 54',
      [hashedPassword]
    );
    
    console.log('✅ Password updated successfully');
    console.log('Email: sds@yopmail.com');
    console.log('Password: password123');
    
    // Verify the update
    const verifyResult = await db.query('SELECT id, email, password_hash FROM companies WHERE id = 54');
    const company = verifyResult.rows[0];
    
    if (bcrypt.compareSync(password, company.password_hash)) {
      console.log('✅ Password verification successful');
    } else {
      console.log('❌ Password verification failed');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  process.exit(0);
}

setCompany54Password();
