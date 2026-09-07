process.env.DATABASE_URL='postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos_test';
const { buildApp } = await import('/home/cassandra/schoolOS/server/src/app.js');
const app = await buildApp({ logger: true, level: 'error' });
const st = await app.inject({ method:'POST', url:'/auth/login', payload:{ email:'student@meridian.edu', password:'schoolos-demo' }, headers:{'content-type':'application/json'} });
const H = { authorization:'Bearer '+st.json().token, 'content-type':'application/json' };
await app.inject({ method:'POST', url:'/plugins/student.world/enable', headers:{ authorization:'Bearer '+(await app.inject({ method:'POST', url:'/auth/login', payload:{ email:'owner@meridian.edu', password:'schoolos-demo' }, headers:{'content-type':'application/json'} })).json().token, 'content-type':'application/json' }, payload:{ version:'1.0.0', class:'C' } });
const r = await app.inject({ method:'GET', url:'/student/mistakes', headers:H });
console.log('STATUS', r.statusCode);
await app.close();
