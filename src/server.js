import { criarApp } from './app.js';
import { caminhoDoBanco, obterBanco } from './db/conexao.js';
import { popularSePrecisar } from './db/seed.js';

const porta = Number(process.env.PORT ?? 3000);

obterBanco();

// Banco vazio na primeira execução carrega a carteira de demonstração. Isso é
// o que deixa o projeto rodar em três comandos: clone, npm install, npm start.
const seed = popularSePrecisar();

criarApp().listen(porta, () => {
  console.log('Gestor de Tráfego Pago');
  console.log(`  interface: http://localhost:${porta}`);
  console.log(`  api:       http://localhost:${porta}/api/saude`);
  console.log(`  banco:     ${caminhoDoBanco()}`);
  if (seed.populou) {
    console.log(
      `  seed:      ${seed.clientes} clientes, ${seed.contas} contas, ${seed.campanhas} campanhas, ` +
        `${seed.metricas} dias de métrica, ${seed.alertas} alertas`
    );
  } else {
    console.log(`  seed:      ignorado (${seed.motivo})`);
  }
  console.log('\nCtrl+C encerra.');
});
