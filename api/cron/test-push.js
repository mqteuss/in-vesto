import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Configuração idêntica ao notificar.js
webpush.setVapidDetails(
  'mailto:mh.umateus@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    try {
        // 1. Busca todas as inscrições no banco
        const { data: subscriptions, error } = await supabase
            .from('push_subscriptions')
            .select('*');

        if (error) throw error;
        
        if (!subscriptions || subscriptions.length === 0) {
            return res.status(200).json({ message: 'Ninguém inscrito. Ative as notificações no app primeiro.' });
        }

        // 2. Mensagem de Teste (Força o envio)
        const payload = JSON.stringify({ 
            title: '🧪 Teste de Notificação', 
            body: 'Seu sistema de Push está funcionando perfeitamente!', 
            url: '/?tab=tab-config' 
        });

        let sucesso = 0;
        let falhas = 0;

        // 3. Envia para todo mundo
        const promises = subscriptions.map(sub => 
            webpush.sendNotification(sub.subscription, payload)
                .then(() => { sucesso++; })
                .catch(err => {
                    console.error('Falha:', err);
                    falhas++;
                })
        );
        
        await Promise.all(promises);

        return res.status(200).json({ 
            status: 'Teste Finalizado', 
            enviados: sucesso, 
            erros: falhas 
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
