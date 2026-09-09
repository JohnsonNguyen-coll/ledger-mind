import type { Express, Request, Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { recoverMessageAddress, type Hex } from 'viem';
import { z } from 'zod';
import type { Store } from './store.js';

type Session = {id:string;tokenHash:string;wallet:string|null;expiresAt:number;nonce:string|null;message:string|null;nonceExpiresAt:number|null};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const lifetime=7*24*60*60*1000;
export function installReportAccess(app:Express,store:Store,csrf:string,appOrigin=''){
  store.db.exec(`CREATE TABLE IF NOT EXISTS web_sessions (id TEXT PRIMARY KEY, tokenHash TEXT NOT NULL UNIQUE, wallet TEXT, expiresAt INTEGER NOT NULL, nonce TEXT, message TEXT, nonceExpiresAt INTEGER);
    CREATE TABLE IF NOT EXISTS report_owners (reportId TEXT PRIMARY KEY REFERENCES treasury_reports(id), sessionId TEXT NOT NULL, wallet TEXT);
    CREATE INDEX IF NOT EXISTS report_owners_wallet ON report_owners(wallet);`);
  const sessions=new WeakMap<Request,Session>();
  const setCookie=(res:Response,value:string)=>res.cookie('lm_session',value,{httpOnly:true,secure:appOrigin.startsWith('https://') || res.req.secure,sameSite:'strict',path:'/',maxAge:lifetime});
  const issue=(res:Response)=>{
    const value=randomBytes(32).toString('hex');const session:Session={id:randomUUID(),tokenHash:digest(value),wallet:null,expiresAt:Date.now()+lifetime,nonce:null,message:null,nonceExpiresAt:null};
    store.db.prepare('INSERT INTO web_sessions(id,tokenHash,expiresAt) VALUES (?,?,?)').run(session.id,session.tokenHash,session.expiresAt);setCookie(res,value);return session;
  };
  app.use((req,res,next)=>{
    const value=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('lm_session='))?.slice(11);
    const session=value && /^[a-f0-9]{64}$/.test(value) ? store.db.prepare('SELECT * FROM web_sessions WHERE tokenHash=? AND expiresAt>?').get(digest(value),Date.now()) as Session|undefined : undefined;
    sessions.set(req,session || issue(res));next();
  });
  const get=(req:Request)=>sessions.get(req)!;
  const requireWallet=(req:Request,payer?:string)=>{
    const session=get(req);if(!session.wallet || (payer && session.wallet!==payer.toLowerCase()))throw new Error('WALLET_SIGN_IN_REQUIRED');return session.wallet;
  };
  const canRead=(req:Request,reportId:string)=>{
    const session=get(req);const owner=store.db.prepare('SELECT * FROM report_owners WHERE reportId=?').get(reportId) as {sessionId:string;wallet:string|null}|undefined;
    return !!owner && (owner.wallet ? owner.wallet===session.wallet : owner.sessionId===session.id);
  };
  const requireReport=(req:Request,id:string)=>{if(!canRead(req,id))throw new Error('REPORT_NOT_FOUND');};
  const ownReport=(req:Request,id:string)=>{const session=get(req);const current=store.db.prepare('SELECT wallet FROM web_sessions WHERE id=?').get(session.id) as {wallet:string|null};store.db.prepare('INSERT INTO report_owners(reportId,sessionId,wallet) VALUES (?,?,?)').run(id,session.id,current.wallet);};
  const list=(req:Request)=>{
    const session=get(req);
    const input=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(10)}).parse(req.query);
    const scope='FROM treasury_reports r JOIN report_owners o ON o.reportId=r.id WHERE (o.wallet IS NULL AND o.sessionId=?) OR (o.wallet IS NOT NULL AND o.wallet=?)';
    const {total}=store.db.prepare(`SELECT COUNT(*) AS total ${scope}`).get(session.id,session.wallet) as {total:number};
    const page=Math.min(input.page,Math.max(1,Math.ceil(total/input.pageSize)));
    const reports=store.db.prepare(`SELECT r.id,r.walletAddress,r.chainId,r.createdAt,r.summary,r.reportHash ${scope} ORDER BY r.rowid DESC LIMIT ? OFFSET ?`).all(session.id,session.wallet,input.pageSize,(page-1)*input.pageSize);
    return {reports,pagination:{page,pageSize:input.pageSize,total}};
  };
  const auth=(req:Request)=>{if(req.header('X-LedgerMind-Token')!==csrf)throw new Error('SESSION_TOKEN_REQUIRED');};
  app.get('/api/wallet/session',(req,res)=>res.json({wallet:get(req).wallet}));
  app.post('/api/wallet/nonce',(req,res)=>{
    auth(req);const {wallet}=z.object({wallet:z.string().regex(/^0x[\da-fA-F]{40}$/)}).strict().parse(req.body);const session=get(req);
    if(session.wallet && session.wallet!==wallet.toLowerCase())throw new Error('SIGN_OUT_BEFORE_CHANGING_WALLET');
    const nonce=randomBytes(16).toString('hex');const expires=Date.now()+300000;
    const loginOrigin=appOrigin || `${req.protocol}://${req.headers.host}`;
    const message=`${new URL(loginOrigin).host} wants you to sign in with your Ethereum account:\n${wallet}\n\nSign in to LedgerMind to access your private reports and premium purchases. This does not authorize a payment.\n\nURI: ${loginOrigin}\nVersion: 1\nChain ID: 8453\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
    store.db.prepare('UPDATE web_sessions SET nonce=?,message=?,nonceExpiresAt=? WHERE id=?').run(nonce,message,expires,session.id);res.json({message});
  });
  app.post('/api/wallet/login',async(req,res)=>{
    auth(req);const {signature}=z.object({signature:z.string().regex(/^0x[\da-fA-F]{130}$/)}).strict().parse(req.body);
    const session=get(req);const current=store.db.prepare('SELECT * FROM web_sessions WHERE id=?').get(session.id) as Session;
    if(!current.nonce || !current.message || !current.nonceExpiresAt || current.nonceExpiresAt<=Date.now())throw new Error('SIGN_IN_CHALLENGE_EXPIRED');
    const used=store.db.prepare('UPDATE web_sessions SET nonce=NULL,message=NULL,nonceExpiresAt=NULL WHERE id=? AND nonce=?').run(session.id,current.nonce);
    if(!used.changes)throw new Error('SIGN_IN_CHALLENGE_EXPIRED');
    const wallet=(await recoverMessageAddress({message:current.message,signature:signature as Hex})).toLowerCase();
    if(wallet!==current.message.split('\n')[1]?.toLowerCase())throw new Error('SIGN_IN_WALLET_MISMATCH');
    // Rotate the credential while keeping the anonymous report ownership ID.
    const value=randomBytes(32).toString('hex');
    store.transaction(()=>{
      const latest=store.db.prepare('SELECT tokenHash FROM web_sessions WHERE id=?').get(session.id) as {tokenHash:string};
      if(latest.tokenHash!==session.tokenHash)throw new Error('SIGN_IN_CHALLENGE_EXPIRED');
      store.db.prepare('UPDATE web_sessions SET wallet=?,tokenHash=?,expiresAt=? WHERE id=?').run(wallet,digest(value),Date.now()+lifetime,session.id);
      store.db.prepare('UPDATE report_owners SET wallet=? WHERE sessionId=? AND wallet IS NULL').run(wallet,session.id);
    });setCookie(res,value);res.json({wallet});
  });
  app.post('/api/wallet/logout',(req,res)=>{
    auth(req);store.db.prepare('UPDATE web_sessions SET tokenHash=?,nonce=NULL,message=NULL,nonceExpiresAt=NULL WHERE id=?').run(digest(randomBytes(32).toString('hex')),get(req).id);
    issue(res);res.json({wallet:null});
  });
  app.use('/api/reports/:id',(req,_res,next)=>{requireReport(req,String(req.params.id));next();});
  return {requireWallet,requireReport,ownReport,canRead,list,sessionId:(req:Request)=>get(req).id};
}
export type ReportAccess=ReturnType<typeof installReportAccess>;
