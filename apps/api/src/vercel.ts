/**
 * Entrada serverless (Vercel). O app Express é o próprio handler (req, res):
 * a mesma aplicação do servidor tradicional, sem adaptações de rota.
 */
import { createApp } from './app';

export default createApp();
