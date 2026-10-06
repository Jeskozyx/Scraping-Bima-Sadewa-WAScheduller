import postgres from 'postgres';

async function check() {
  const connStr = 'postgresql://postgres.rswkkogynttthwlioxfy:QZg%25Yi27B%3Fkc.xv@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
  const sql = postgres(connStr, { ssl: 'require' });

  try {
    const res = await sql`SELECT 1 as test`;
    console.log('✅ Pooler connection success:', res);
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    console.log('Tables in public schema:', tables.map(t => t.table_name));
    process.exit(0);
  } catch (err) {
    console.error('Error connecting to pooler:', err.message);
    process.exit(1);
  }
}

check();
