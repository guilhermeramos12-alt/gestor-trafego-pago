import { criarApp } from './app.js';
import { caminhoDoBanco, obterBanco } from './db/conexao.js';

const porta = Number(process.env.PORT ?? 3000);

obterBanco();

criarApp().listen(porta, () => {
  console.log('Gestor de Tráfego Pago');
  console.log(`  interface: http://localhost:${porta}`);
  console.log(`  api:       http://localhost:${porta}/api/saude`);
  console.log(`  banco:     ${caminhoDoBanco()}`);
  console.log('\nCtrl+C encerra.');
});
