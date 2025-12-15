import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Configura Web Push com as mesmas chaves do oficial
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
        // 1. Busca TODAS as inscrições no banco (sem filtrar por usuário ou data)
        const { data: subscriptions, error } = await supabase
            .from('push_subscriptions')
            .select('*');

        if (error) throw error;
        
        if (!subscriptions || subscriptions.length === 0) {
            return res.status(200).json({ message: 'Nenhuma inscrição encontrada no banco. Ative o botão no app primeiro.' });
        }

        // 2. Define a mensagem de teste
        const payload = JSON.stringify({ 
            title: '🧪 Teste Vesto', 
            body: 'Se você está lendo isso, o sistema funcionou perfeitamente!', 
            url: '/?tab=tab-config' 
        });

        let sucesso = 0;
        let falhas = 0;

        // 3. Dispara para todos os dispositivos encontrados
        const promises = subscriptions.map(sub => 
            webpush.sendNotification(sub.subscription, payload)
                .then(() => {
                    sucesso++;
                })
                .catch(err => {
                    console.error('Erro no envio:', err);
                    falhas++;
                    // Se der erro 410 (Gone), poderíamos deletar do banco aqui
                })
        );
        
        await Promise.all(promises);

        return res.status(200).json({ 
            status: 'Concluído', 
            total_encontrado: subscriptions.length,
            enviados_sucesso: sucesso,
            falhas: falhas
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}