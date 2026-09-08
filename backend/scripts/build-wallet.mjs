import { build } from 'esbuild';
await build({entryPoints:{wallet:'frontend/premium.tsx'},bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',outdir:'dist/frontend',chunkNames:'wallet-chunks/[name]-[hash]',minify:true,define:{'process.env.NODE_ENV':'"production"'},logLevel:'info'});
