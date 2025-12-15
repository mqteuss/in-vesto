import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Configuração do Web Push
// As chaves são lidas das variáveis de ambiente do Vercel para segurança.
webpush.setVapidDetails(
  'mailto:mh.umateus@gmail.com', // Seu email de contato
  process.env.VAPID_PUBLIC_KEY,    // Lê a variável que você vai criar no Vercel
  process.env.VAPID_PRIVATE_KEY    // Lê a variável que você vai criar no Vercel
);

// Inicializa o Supabase com a chave de serviço (Service Role)
// Confirmado que você já tem essas variáveis configuradas no Vercel.
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    try {
        // Ajuste de data para o horário de Brasília (UTC-3)
        const hoje = new Date();
        hoje.setHours(hoje.getHours() - 3); 
        const hojeString = hoje.toISOString().split('T')[0];

        // 1. Buscar Proventos de HOJE (Pagamento ou Data Com)
        const { data: proventos } = await supabase
            .from('proventosconhecidos')
            .select('*')
            .or(`paymentdate.eq.${hojeString},datacom.eq.${hojeString}`);

        if (!proventos || proventos.length === 0) {
            return res.status(200).json({ message: 'Nenhum evento financeiro localizado para a data de hoje.' });
        }

        // 2. Agrupar eventos por usuário
        const userEvents = {};
        proventos.forEach(p => {
            if (!userEvents[p.user_id]) userEvents[p.user_id] = [];
            userEvents[p.user_id].push(p);
        });

        let totalSent = 0;

        // 3. Processar envio para cada usuário
        for (const userId of Object.keys(userEvents)) {
            const eventos = userEvents[userId];
            
            // Busca as inscrições (dispositivos) deste usuário
            const { data: subscriptions } = await supabase
                .from('push_subscriptions')
                .select('subscription')
                .eq('user_id', userId);

            if (!subscriptions || subscriptions.length === 0) continue;

            // Filtrar e priorizar tipos de eventos
            const pagamentos = eventos.filter(e => e.paymentdate === hojeString);
            const dataComs = eventos.filter(e => e.datacom === hojeString);
            
            let title = 'Vesto - Atualização';
            let body = '';

            // Lógica de Mensagem Profissional
            if (pagamentos.length > 0) {
                const symbols = pagamentos.map(p => p.symbol).slice(0, 3).join(', ');
                const count = pagamentos.length;
                
                title = 'Pagamento de Proventos';
                if (count === 1) {
                    body = `O pagamento do ativo ${symbols} foi confirmado para hoje.`;
                } else {
                    body = `Pagamentos confirmados hoje para: ${symbols}${count > 3 ? ' e outros' : ''}.`;
                }
            } else if (dataComs.length > 0) {
                const symbols = dataComs.map(p => p.symbol).slice(0, 3).join(', ');
                const count = dataComs.length;

                title = 'Data de Corte (Data Com)';
                if (count === 1) {
                    body = `Hoje é a data limite para garantir direitos aos proventos de ${symbols}.`;
                } else {
                    body = `Data limite hoje para os ativos: ${symbols}${count > 3 ? ' e outros' : ''}.`;
                }
            }

            const payload = JSON.stringify({ 
                title, 
                body, 
                url: '/?tab=tab-carteira' 
            });

            // Envia notificação para todas as inscrições ativas do usuário
            const pushPromises = subscriptions.map(sub => 
                webpush.sendNotification(sub.subscription, payload)
                    .catch(err => {
                        // Trata inscrições inválidas ou expiradas (Status 410 ou 404)
                        if (err.statusCode === 410 || err.statusCode === 404) {
                            console.log(`[Push] Removendo inscrição expirada para o usuário ${userId}`);
                            supabase.from('push_subscriptions')
                                .delete()
                                .match({ id: sub.id })
                                .then(() => {});
                        } else {
                            console.error('[Push Error]', err);
                        }
                    })
            );
            
            await Promise.all(pushPromises);
            totalSent += pushPromises.length;
        }

        return res.status(200).json({ status: 'Success', notifications_sent: totalSent });

    } catch (error) {
        console.error('[Cron Error]:', error);
        return res.status(500).json({ error: 'Erro interno no processamento das notificações.' });
    }
}