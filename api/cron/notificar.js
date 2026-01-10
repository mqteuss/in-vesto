const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

// Ajuste o caminho do scraper conforme necessário
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
        console.error("Erro interno no Scraper:", e.message);
        return [];
    }
}

module.exports = async function handler(req, res) {
    try {
        console.log("Iniciando processamento...");
        const start = Date.now();

        // 1. ATUALIZAÇÃO DA BASE DE DADOS
        const { data: ativos } = await supabase.from('transacoes').select('symbol');

        if (ativos?.length > 0) {
            const uniqueSymbols = [...new Set(ativos.map(a => a.symbol))];

            if (uniqueSymbols.length > 0) {
                const novosDados = await atualizarProventosPeloScraper(uniqueSymbols);

                if (novosDados?.length > 0) {
                    const upserts = [];
                    const { data: allTransacoes } = await supabase
                        .from('transacoes')
                        .select('user_id, symbol');

                    for (const dado of novosDados) {
                        if (!dado.paymentDate || !dado.value) continue;

                        const usersInteressados = allTransacoes
                            .filter(t => t.symbol === dado.symbol)
                            .map(u => u.user_id);

                        const usersUnicos = [...new Set(usersInteressados)];

                        usersUnicos.forEach(uid => {
                             const tipoProvento = (dado.type || 'REND').toUpperCase().trim();
                             const valorFormatadoID = parseFloat(dado.value).toFixed(4);
                             const idGerado = `${dado.symbol}_${dado.paymentDate}_${tipoProvento}_${valorFormatadoID}`;

                             upserts.push({
                                 id: idGerado,
                                 user_id: uid,
                                 symbol: dado.symbol,
                                 value: dado.value,
                                 paymentdate: dado.paymentDate,
                                 datacom: dado.dataCom,
                                 type: tipoProvento, 
                                 processado: false
                             });
                        });
                    }

                    if (upserts.length > 0) {
                        for (let i = 0; i < upserts.length; i += 200) {
                            await supabase.from('proventosconhecidos')
                                .upsert(upserts.slice(i, i + 200), { onConflict: 'user_id, id', ignoreDuplicates: true });
                        }
                    }
                }
            }
        }

        // 2. ENVIO DE NOTIFICAÇÕES
        const agora = new Date();
        agora.setHours(agora.getHours() - 3); 
        const hojeString = agora.toISOString().split('T')[0];
        const inicioDoDia = `${hojeString}T00:00:00`;
        const hojeDateObj = new Date(hojeString + 'T00:00:00');

        const { data: proventos } = await supabase
            .from('proventosconhecidos')
            .select('*')
            .or(`paymentdate.eq.${hojeString},datacom.eq.${hojeString},created_at.gte.${inicioDoDia}`);

        if (!proventos?.length) {
            return res.json({ status: 'OK', msg: 'Nenhum evento relevante hoje.' });
        }

        const userEvents = {};
        proventos.forEach(p => {
            if (!userEvents[p.user_id]) userEvents[p.user_id] = [];
            userEvents[p.user_id].push(p);
        });

        let totalSent = 0;
        const usersIds = Object.keys(userEvents);

        await Promise.all(usersIds.map(async (userId) => {
            try {
                const eventos = userEvents[userId];
                const { data: subs } = await supabase
                    .from('push_subscriptions').select('*').eq('user_id', userId);

                if (!subs?.length) return;

                const matchDate = (f, s) => f && f.startsWith(s);

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

                // Icon: Imagem grande colorida
                const icon = 'https://in-vesto.vercel.app/logo-vesto.png'; 

                // Badge: Sininho monocromático
                // IMPORTANTE: O arquivo 'sininho.png' DEVE estar dentro da pasta 'public' do projeto
                const badge = 'https://in-vesto.vercel.app/sininhov2.png';

                if (pagamentos.length > 0) {
                    const lista = pagamentos.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).join(', ');
                    title = 'Crédito de Proventos';
                    body = pagamentos.length === 1 
                        ? `O ativo ${pagamentos[0].symbol} realizou pagamento de ${fmtBRL(pagamentos[0].value)}/cota hoje.` 
                        : `Pagamentos realizados hoje: ${lista}.`;

                } else if (dataComs.length > 0) {
                    const lista = dataComs.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).join(', ');
                    title = 'Data Com (Corte)';
                    body = `Data limite registrada hoje para: ${lista}.`;

                } else if (novosAnuncios.length > 0) {
                    const lista = novosAnuncios.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).slice(0,3).join(', ');
                    title = 'Comunicado de Proventos';
                    body = novosAnuncios.length === 1
                        ? `Comunicado: ${novosAnuncios[0].symbol} anunciou pagamento de ${fmtBRL(novosAnuncios[0].value)}/cota.`
                        : `Novos anúncios: ${lista}${novosAnuncios.length > 3 ? '...' : ''}`;
                } else {
                    return; 
                }

                const payload = JSON.stringify({ 
                    title, 
                    body, 
                    icon, 
                    badge,
                    url: '/?tab=tab-carteira'
                });

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
                console.error(`Erro user ${userId}:`, errUser.message);
            }
        }));

        const duration = (Date.now() - start) / 1000;
        console.log(`Concluído em ${duration}s. Envios: ${totalSent}`);
        return res.status(200).json({ status: 'Success', sent: totalSent, time: duration });

    } catch (error) {
        console.error('Erro Fatal:', error);
        return res.status(500).json({ error: error.message });
    }
};