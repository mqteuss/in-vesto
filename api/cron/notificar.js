const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
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

// Formata dinheiro (R$ 0,00)
const fmtBRL = (val) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function atualizarProventosPeloScraper(fiiList) {
    const req = { method: 'POST', body: { mode: 'proventos_carteira', payload: { fiiList } } };
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
        console.error("Scraper Error:", e);
        return [];
    }
}

module.exports = async function handler(req, res) {
    try {
        console.log("🚀 Iniciando CRON Inteligente...");
        const start = Date.now();
        
        // --- 1. ATUALIZAÇÃO INTELIGENTE (Mantida) ---
        const { data: ativos } = await supabase.from('transacoes').select('symbol');
        
        if (ativos?.length > 0) {
            const uniqueSymbols = [...new Set(ativos.map(a => a.symbol))];
            const novosDados = await atualizarProventosPeloScraper(uniqueSymbols);
            
            if (novosDados?.length > 0) {
                const upserts = [];
                // Otimização: Busca todos os users de uma vez só
                const { data: allTransacoes } = await supabase
                    .from('transacoes')
                    .select('user_id, symbol');

                for (const dado of novosDados) {
                    if (!dado.paymentDate || !dado.value) continue;
                    
                    // Filtra na memória (mais rápido que ir no banco N vezes)
                    const usersInteressados = allTransacoes
                        .filter(t => t.symbol === dado.symbol)
                        .map(u => u.user_id);
                    
                    const usersUnicos = [...new Set(usersInteressados)];
                    
                    usersUnicos.forEach(uid => {
                         upserts.push({
                             id: `${dado.symbol}_${dado.paymentDate}`,
                             user_id: uid,
                             symbol: dado.symbol,
                             value: dado.value,
                             paymentdate: dado.paymentDate,
                             datacom: dado.dataCom,
                             processado: false
                         });
                    });
                }
                
                if (upserts.length > 0) {
                    // Salva em lotes maiores (menos chamadas ao banco)
                    for (let i = 0; i < upserts.length; i += 200) {
                        await supabase.from('proventosconhecidos')
                            .upsert(upserts.slice(i, i + 200), { onConflict: 'user_id, id', ignoreDuplicates: true });
                    }
                }
            }
        }

        // --- 2. NOTIFICAÇÃO TURBO ---
        const agora = new Date();
        agora.setHours(agora.getHours() - 3); 
        const hojeString = agora.toISOString().split('T')[0];
        const inicioDoDia = `${hojeString}T00:00:00`;
        const hojeDateObj = new Date(hojeString + 'T00:00:00');

        const { data: proventos } = await supabase
            .from('proventosconhecidos')
            .select('*')
            .or(`paymentdate.eq.${hojeString},datacom.eq.${hojeString},created_at.gte.${inicioDoDia}`);

        if (!proventos?.length) return res.json({ status: 'OK', msg: 'Nada hoje.' });

        // Agrupamento
        const userEvents = {};
        proventos.forEach(p => {
            if (!userEvents[p.user_id]) userEvents[p.user_id] = [];
            userEvents[p.user_id].push(p);
        });

        let totalSent = 0;
        const usersIds = Object.keys(userEvents);

        // OTIMIZAÇÃO: Promise.all para enviar para todos os usuários AO MESMO TEMPO
        await Promise.all(usersIds.map(async (userId) => {
            try {
                const eventos = userEvents[userId];
                const { data: subs } = await supabase
                    .from('push_subscriptions').select('*').eq('user_id', userId);

                if (!subs?.length) return;

                const matchDate = (f, s) => f && f.startsWith(s);
                
                // Filtros
                const pagamentos = eventos.filter(e => matchDate(e.paymentdate, hojeString));
                const dataComs = eventos.filter(e => matchDate(e.datacom, hojeString));
                const novosAnuncios = eventos.filter(e => {
                    const createdToday = (e.created_at || '').startsWith(hojeString);
                    const duplicate = matchDate(e.datacom, hojeString) || matchDate(e.paymentdate, hojeString);
                    let isFuturo = false;
                    if (e.paymentdate) {
                        const d = new Date(e.paymentdate.split('T')[0] + 'T00:00:00');
                        isFuturo = d >= hojeDateObj;
                    }
                    return createdToday && !duplicate && isFuturo;
                });

                let title = '', body = '';
                // Ícone padrão (pode trocar pela URL do seu logo na Vercel)
                const icon = '/android-chrome-192x192.png'; 

                // Lógica de Texto Inteligente
                if (pagamentos.length > 0) {
                    const total = pagamentos.reduce((acc, curr) => acc + curr.value, 0); // Soma simples dos unitários
                    const lista = pagamentos.map(p => `${p.symbol} (${fmtBRL(p.value)})`).join(', ');
                    
                    title = '💰 Dinheiro na Conta!';
                    // Se tiver muitos, resume. Se for pouco, detalha.
                    body = pagamentos.length === 1 
                        ? `O pagamento de ${lista} caiu hoje.` 
                        : `${pagamentos.length} ativos pagaram hoje: ${lista}.`;

                } else if (dataComs.length > 0) {
                    const lista = dataComs.map(p => `${p.symbol} (${fmtBRL(p.value)})`).join(', ');
                    title = '📅 Agenda de Dividendos';
                    body = `Data Com hoje! Garanta proventos de: ${lista}.`;

                } else if (novosAnuncios.length > 0) {
                    const lista = novosAnuncios.map(p => `${p.symbol} (${fmtBRL(p.value)})`).slice(0,3).join(', ');
                    title = '🔔 Novo Anúncio';
                    body = novosAnuncios.length === 1
                        ? `FII Informa: ${novosAnuncios[0].symbol} vai pagar ${fmtBRL(novosAnuncios[0].value)}.`
                        : `Novos anúncios de: ${lista}${novosAnuncios.length > 3 ? '...' : ''}`;
                } else {
                    return; 
                }

                const payload = JSON.stringify({ 
                    title, 
                    body, 
                    icon,
                    url: '/?tab=tab-carteira',
                    // Adiciona badge para Android
                    badge: '/favicon.ico' 
                });
                
                // Envia para todos os dispositivos deste usuário
                const pushPromises = subs.map(sub => 
                    webpush.sendNotification(sub.subscription, payload).catch(err => {
                        if (err.statusCode === 410 || err.statusCode === 404) {
                            supabase.from('push_subscriptions').delete().match({ id: sub.id }).then(()=>{});
                        }
                    })
                );
                await Promise.all(pushPromises);
                totalSent += pushPromises.length;

            } catch (errUser) {
                console.error(`Erro ao notificar user ${userId}:`, errUser);
                // Não quebra o loop dos outros usuários
            }
        }));

        const duration = (Date.now() - start) / 1000;
        console.log(`✅ Finalizado em ${duration}s. Enviados: ${totalSent}`);
        return res.status(200).json({ status: 'Success', sent: totalSent, time: duration });

    } catch (error) {
        console.error('CRON FATAL ERROR:', error);
        return res.status(500).json({ error: error.message });
    }
};