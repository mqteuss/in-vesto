import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import scraperHandler from './scraper.js';

// Configuração Web Push
webpush.setVapidDetails(
  'mailto:mh.umateus@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Função auxiliar para rodar o scraper internamente
async function atualizarProventosPeloScraper(fiiList) {
    const req = {
        method: 'POST',
        body: { mode: 'proventos_carteira', payload: { fiiList } }
    };
    
    let resultado = [];
    // Simula o objeto Response (res) que o scraper espera
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

export default async function handler(req, res) {
    try {
        console.log("Executando rotina diária de atualização e notificação...");
        
        // =================================================================
        // ETAPA 1: ATUALIZAÇÃO AUTOMÁTICA DOS DADOS (AUTO-UPDATE)
        // =================================================================
        
        const { data: ativos } = await supabase.from('transacoes').select('symbol');
        
        if (ativos && ativos.length > 0) {
            const uniqueSymbols = [...new Set(ativos.map(a => a.symbol))];
            
            // Busca dados novos na fonte (usando o scraper importado)
            const novosDados = await atualizarProventosPeloScraper(uniqueSymbols);
            
            if (novosDados && novosDados.length > 0) {
                const upserts = [];
                
                for (const dado of novosDados) {
                    if (!dado.paymentDate || !dado.value) continue;
                    
                    const { data: usersWithAsset } = await supabase
                        .from('transacoes')
                        .select('user_id')
                        .eq('symbol', dado.symbol);
                        
                    if (usersWithAsset) {
                         const usersUnicos = [...new Set(usersWithAsset.map(u => u.user_id))];
                         
                         usersUnicos.forEach(uid => {
                             const idUnico = `${dado.symbol}_${dado.paymentDate}`;
                             upserts.push({
                                 id: idUnico,
                                 user_id: uid,
                                 symbol: dado.symbol,
                                 value: dado.value,
                                 paymentdate: dado.paymentDate,
                                 datacom: dado.dataCom,
                                 processado: false
                             });
                         });
                    }
                }
                
                if (upserts.length > 0) {
                    for (let i = 0; i < upserts.length; i += 100) {
                        const batch = upserts.slice(i, i + 100);
                        await supabase.from('proventosconhecidos')
                            .upsert(batch, { onConflict: 'user_id, id', ignoreDuplicates: true });
                    }
                    console.log(`Base de dados sincronizada: ${upserts.length} registros processados.`);
                }
            }
        }

        // =================================================================
        // ETAPA 2: ENVIO DE NOTIFICAÇÕES (PUSH)
        // =================================================================
        
        const agora = new Date();
        agora.setHours(agora.getHours() - 3); 
        const hojeString = agora.toISOString().split('T')[0];
        const inicioDoDia = `${hojeString}T00:00:00`;

        const { data: proventos, error } = await supabase
            .from('proventosconhecidos')
            .select('*')
            .or(`paymentdate.eq.${hojeString},datacom.eq.${hojeString},created_at.gte.${inicioDoDia}`);

        if (error) throw error;

        if (!proventos || proventos.length === 0) {
            return res.status(200).json({ status: 'Updated', message: 'Nenhum evento financeiro relevante para hoje.' });
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
                .from('push_subscriptions')
                .select('*')
                .eq('user_id', userId);

            if (!subscriptions || subscriptions.length === 0) continue;

            const pagamentos = eventos.filter(e => e.paymentdate === hojeString);
            const dataComs = eventos.filter(e => e.datacom === hojeString);
            
            // Novos anúncios (criados hoje, sem conflito de data de pagamento)
            const novosAnuncios = eventos.filter(e => 
                e.created_at >= inicioDoDia && 
                e.datacom !== hojeString && 
                e.paymentdate !== hojeString
            );
            
            let title = '';
            let body = '';

            // --- LÓGICA DE TEXTO (Profissional / Sem Emojis) ---
            
            if (pagamentos.length > 0) {
                const symbols = pagamentos.map(p => p.symbol).slice(0, 3).join(', ');
                const count = pagamentos.length;
                
                title = 'Proventos Recebidos';
                if (count === 1) {
                    body = `Crédito confirmado: O pagamento de ${symbols} foi realizado.`;
                } else {
                    body = `Créditos confirmados hoje para: ${symbols}${count > 3 ? ' e outros' : ''}.`;
                }
            
            } else if (dataComs.length > 0) {
                const symbols = dataComs.map(p => p.symbol).slice(0, 3).join(', ');
                const count = dataComs.length;
                
                title = 'Agenda de Dividendos';
                if (count === 1) {
                    body = `Data Com: Hoje é o limite para garantir proventos de ${symbols}.`;
                } else {
                    body = `Data Com hoje para os ativos: ${symbols}${count > 3 ? ' e outros' : ''}.`;
                }

            } else if (novosAnuncios.length > 0) {
                const symbols = novosAnuncios.map(p => p.symbol).slice(0, 3).join(', ');
                const count = novosAnuncios.length;
                
                title = 'Novo Comunicado';
                if (count === 1) {
                    const p = novosAnuncios[0];
                    const valorFmt = p.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    body = `${p.symbol} informou distribuição de ${valorFmt} por cota.`;
                } else {
                    body = `Novos anúncios de rendimentos: ${symbols}${count > 3 ? ' e outros' : ''}.`;
                }
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
}
