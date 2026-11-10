import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from '../server/routes/auth.js';
import calendarRoutes from '../server/routes/calendar.js';
import ocrRoutes from '../server/routes/ocr.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/ocr', ocrRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

export default app;
