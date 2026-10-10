# Lousa Digital — instalação (Vercel + Firebase + Mercado Pago)

## Como o endereço fica sempre `minhalousadigital.vercel.app`
`index.html` é só uma moldura que abre as páginas (`site.html`, `login.html`, `lousa.html`, `painel.html`) por dentro.
O navegador nunca mostra `/login.html` etc. Recarregar a página volta para a tela em que você estava.

## 1. Subir para a Vercel
Envie esta pasta inteira (com `api/`, `lib/`, `package.json`, `vercel.json`) para o GitHub e importe na Vercel,
ou rode `vercel --prod` dentro dela.

## 2. Variável de ambiente (Vercel > Settings > Environment Variables)
- `FIREBASE_SERVICE_ACCOUNT` = conteúdo do JSON da conta de serviço
  (Firebase > Configurações do projeto > Contas de serviço > Gerar nova chave privada). Cole o JSON inteiro.
- Opcionais: `OWNER_EMAIL` (padrão excellentservices.excel@gmail.com) e `SITE_URL` (padrão https://minhalousadigital.vercel.app).

Depois de salvar, faça um novo deploy.

## 3. Firebase
- Authentication > Settings > Authorized domains: adicione `minhalousadigital.vercel.app`.
- Firestore > Regras: aplique o trecho de `firestore.rules` (mantendo suas regras de `shared` e `invites`).
  Isso impede que alguém se dê o plano Pro pelo navegador.

## 4. Mercado Pago
1. Entre em `minhalousadigital.vercel.app`, faça login com excellentservices.excel@gmail.com: você cai direto no painel.
2. Painel > Mercado Pago: cole o Access Token de produção (APP_USR-...) e clique em Testar conexão.
3. No Mercado Pago (Suas integrações > Webhooks) cadastre `https://minhalousadigital.vercel.app/api/webhook`,
   evento "Planos e assinaturas", copie a chave secreta e cole no painel.
4. Painel > Assinatura: defina o valor. Marque "aplicar a quem já assina" para atualizar as cobranças ativas.

## Como a cobrança funciona
O botão "Assinar o Pro" cria uma assinatura recorrente no Mercado Pago e leva a pessoa ao checkout dele.
A 1ª cobrança é no ato e as próximas caem sozinhas todo mês na mesma data. O webhook libera ou corta o acesso.
Cancelamento: pelo painel (Usuários) ou pela conta da pessoa no Mercado Pago; o acesso vale até o fim do período já pago.

## Painel
Visão geral, usuários (liberar/remover Pro, cancelar assinatura, bloquear), valor da assinatura, chaves do Mercado Pago
e equipe (autorizar outros e-mails). Só o dono altera as chaves e a equipe.

## Cobrança, tolerância de 5 dias e cancelamento automático
- Quem paga o Pro aparece no painel em **Assinantes Pro**, com data de entrada, próxima cobrança automática e situação.
- Venceu e não pagou? A pessoa continua com o Pro por **5 dias de tolerância** e vê um aviso na lousa. Passou disso sem pagar, a assinatura é
  cancelada no Mercado Pago e a conta volta para o plano Grátis (o que ela criou continua salvo). Quem comprou e nunca pagou também tem 5 dias.
- Quem você liberou à mão (Liberar Pro) **nunca** é cobrado nem recebe aviso.
- O sistema descobre sozinho se pagou: o Mercado Pago avisa o webhook a cada cobrança. No Mercado Pago (Webhooks) marque os DOIS eventos:
  **Planos e assinaturas** e **Pagamentos recorrentes de assinaturas**.
- `api/cron.js` roda todo dia (vercel.json) e cancela quem passou dos 5 dias. Opcional: crie `CRON_SECRET` na Vercel (qualquer texto longo)
  para só a Vercel conseguir chamar essa rotina.
