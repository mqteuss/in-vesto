const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
// IMPORTANTE: Sobe um nível (..) para achar o scraper na pasta pai 'api'
const scraperHandler = require('../scraper.js');

webpush.setVapidDetails(
  'mailto:mh.umateus@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function atualizarProventosPeloScraper(fiiList) {
    const req = {
        method: 'POST',
        body: { mode: 'proventos_carteira', payload: { fiiList } }
    };
    
    let resultado = [];
    const res = {
        setHeader: () => {},
        status: () => ({ json: (data) => { resultado = data.json; } }),
        json: (data) => { resultado = data.json; }
    };

    try {
        await scraperHandler(req, res);
        return resultado || [];
    } catch (e) {
        console.error("Erro interno no Scraper:", e);
        return [];
    }
}

module.exports = async function handler(req, res) {
    try {
        console.log("Iniciando CRON...");
        
        // 1. ATUALIZA DADOS
        const { data: ativos } = await supabase.from('transacoes').select('symbol');
        
        if (ativos && ativos.length > 0) {
            const uniqueSymbols = [...new Set(ativos.map(a => a.symbol))];
            const novosDados = await atualizarProventosPeloScraper(uniqueSymbols);
            
            if (novosDados && novosDados.length > 0) {
                const upserts = [];
                for (const dado of novosDados) {
                    if (!dado.paymentDate || !dado.value) continue;
                    
                    const { data: usersWithAsset } = await supabase
                        .from('transacoes').select('user_id').eq('symbol', dado.symbol);
                        
                    if (usersWithAsset) {
                         const usersUnicos = [...new Set(usersWithAsset.map(u => u.user_id))];
                         usersUnicos.forEach(uid => {
                             const idUnico = `${dado.symbol}_${dado.paymentDate}`;
                             upserts.push({
                                 id: idUnico, user_id: uid, symbol: dado.symbol,
                                 value: dado.value, paymentdate: dado.paymentDate,
                                 datacom: dado.dataCom, processado: false
                             });
                         });
                    }
                }
                
                if (upserts.length > 0) {
                    for (let i = 0; i < upserts.length; i += 50) {
                        const batch = upserts.slice(i, i + 50);
                        await supabase.from('proventosconhecidos')
                            .upsert(batch, { onConflict: 'user_id, id', ignoreDuplicates: true });
                    }
                }
            }
        }

        // 2. ENVIA PUSH
        const agora = new Date();
        agora.setHours(agora.getHours() - 3); 
        const hojeString = agora.toISOString().split('T')[0];
        const inicioDoDia = `${hojeString}T00:00:00`;
        const hojeDateObj = new Date(hojeString + 'T00:00:00');

        const { data: proventos } = await supabase
            .from('proventosconhecidos')
            .select('*')
            .or(`paymentdate.eq.${hojeString},datacom.eq.${hojeString},created_at.gte.${inicioDoDia}`);

        if (!proventos || proventos.length === 0) {
            return res.status(200).json({ status: 'Updated', message: 'Sem notificações.' });
        }

        const userEvents = {};
        proventos.forEach(p => {
            if (!userEvents[p.user_id]) userEvents[p.user_id] = [];
            userEvents[p.user_id].push(p);
        });

        let totalSent = 0;

        for (const userId of Object.keys(userEvents)) {
            const eventos = userEvents[userId];
            const { data: subscriptions } = await supabase
                .from('push_subscriptions').select('*').eq('user_id', userId);

            if (!subscriptions || subscriptions.length === 0) continue;

            const matchDate = (dateField, dateString) => dateField && dateField.startsWith(dateString);

            const pagamentos = eventos.filter(e => matchDate(e.paymentdate, hojeString));
            const dataComs = eventos.filter(e => matchDate(e.datacom, hojeString));
            
            // FILTRO DE NOVOS ANÚNCIOS (BLINDADO)
            const novosAnuncios = eventos.filter(e => {
                const propsCreatedAt = e.created_at || '';
                const isCreatedToday = propsCreatedAt.startsWith(hojeString);
                
                const isDuplicate = matchDate(e.datacom, hojeString) || matchDate(e.paymentdate, hojeString);
                
                // Ignora datas passadas (Velharia)
                let isFuturo = false;
                if (e.paymentdate) {
                    const dataPagObj = new Date(e.paymentdate.split('T')[0] + 'T00:00:00');
                    isFuturo = dataPagObj >= hojeDateObj;
                }

                return isCreatedToday && !isDuplicate && isFuturo;
            });
            
            let title = '';
            let body = '';

            if (pagamentos.length > 0) {
                const symbols = pagamentos.map(p => p.symbol).slice(0, 3).join(', ');
                title = 'Proventos Recebidos';
                body = `Crédito confirmado: O pagamento de ${symbols} foi realizado.`;
            } else if (dataComs.length > 0) {
                const symbols = dataComs.map(p => p.symbol).slice(0, 3).join(', ');
                title = 'Agenda de Dividendos';
                body = `Data Com: Hoje é o limite para garantir proventos de ${symbols}.`;
            } else if (novosAnuncios.length > 0) {
                const symbols = novosAnuncios.map(p => p.symbol).slice(0, 3).join(', ');
                title = 'Novo Comunicado';
                body = `Novos anúncios de rendimentos: ${symbols}.`;
            } else {
                continue; 
            }

            const payload = JSON.stringify({ title, body, url: '/?tab=tab-carteira' });
            
            const pushPromises = subscriptions.map(sub => 
                webpush.sendNotification(sub.subscription, payload).catch(err => {
                     if (err.statusCode === 410 || err.statusCode === 404) {
                        supabase.from('push_subscriptions').delete().match({ id: sub.id }).then(() => {});
                     }
                })
            );
            await Promise.all(pushPromises);
            totalSent += pushPromises.length;
        }

        return res.status(200).json({ status: 'Success', updated: true, notifications_sent: totalSent });
    } catch (error) {
        console.error('CRON ERROR:', error);
        return res.status(500).json({ error: error.message });
    }
};