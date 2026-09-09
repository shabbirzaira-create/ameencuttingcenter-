require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { BrevoClient } = require('@getbrevo/brevo');

const brevo = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY,
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'ameen-cutting-center.html'));
});

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI not set. Add it to the .env file (see .env.example).');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

const OrderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  message: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const Order = mongoose.model('Order', OrderSchema);

const RatingSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  message: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const Rating = mongoose.model('Rating', RatingSchema);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/orders', async (req, res) => {
  try {
    const { name, phone, message } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required.' });
    }
    const order = await Order.create({ name, phone, message });

    if (brevo && process.env.NOTIFY_EMAIL && process.env.FROM_EMAIL) {
      try {
        const html =
          '<h3>New Cutting Request</h3>' +
          '<p><b>Name:</b> ' + escapeHtml(name) + '</p>' +
          '<p><b>Phone:</b> ' + escapeHtml(phone) + '</p>' +
          '<p><b>Details:</b> ' + escapeHtml(message || '—') + '</p>';
        await brevo.transactionalEmails.sendTransacEmail({
          subject: '🪚 New cutting request: ' + name,
          htmlContent: html,
          sender: { email: process.env.FROM_EMAIL, name: process.env.FROM_NAME || 'Ameen Cutting Center' },
          to: [{ email: process.env.NOTIFY_EMAIL, name: 'Shop Owner' }],
        });
        console.log('📧 Notification email sent to', process.env.NOTIFY_EMAIL);
      } catch (mailErr) {
        console.error('❌ Email send failed:', mailErr.message);
      }
    }

    res.status(201).json({ success: true, id: order._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

app.get('/api/orders', async (_req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(50);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ratings', async (req, res) => {
  try {
    const { name, rating, message } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }
    const created = await Rating.create({
      name: name.trim(),
      rating: r,
      message: String(message).trim(),
    });

    if (brevo && process.env.NOTIFY_EMAIL && process.env.FROM_EMAIL) {
      try {
        const stars = '★'.repeat(r);
        const msg = String(message || '').trim() || '—';
        const html =
          '<h3>New Rating Received</h3>' +
          '<p><b>Name:</b> ' + escapeHtml(name.trim()) + '</p>' +
          '<p><b>Rating:</b> ' + stars + ' (' + r + '/5)</p>' +
          '<p><b>Message:</b> ' + escapeHtml(msg) + '</p>' +
          '<p><b>Message sentiment:</b> ' + (r >= 4 ? '😊 Customer is happy' : r === 3 ? '😐 Neutral — maybe follow up' : '😟 Customer is unhappy — please follow up') + '</p>';
        await brevo.transactionalEmails.sendTransacEmail({
          subject: '⭐ New ' + r + '/5 rating from ' + name.trim(),
          htmlContent: html,
          sender: { email: process.env.FROM_EMAIL, name: process.env.FROM_NAME || 'Ameen Cutting Center' },
          to: [{ email: process.env.NOTIFY_EMAIL, name: 'Shop Owner' }],
        });
        console.log('📧 Rating notification email sent to', process.env.NOTIFY_EMAIL);
      } catch (mailErr) {
        console.error('❌ Rating email send failed:', mailErr.message);
      }
    }

    res.status(201).json({ success: true, id: created._id, name: created.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ratings', async (_req, res) => {
  try {
    const ratings = await Rating.find().sort({ createdAt: -1 }).limit(100);
    res.json(ratings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ratings/stats', async (_req, res) => {
  try {
    const stats = await Rating.aggregate([
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]);
    if (stats.length === 0) return res.json({ avg: 0, count: 0 });
    res.json({ avg: Math.round(stats[0].avg * 10) / 10, count: stats[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
