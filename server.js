// server.js - Jayam Travels Booking Backend
// Deploy on Render with TiDB MySQL and Razorpay

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();
app.use(cors({
    origin: ['http://localhost:5500', 'https://your-frontend-domain.com', 'https://jayam-travels.com'],
    credentials: true
}));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ====== DATABASE CONNECTION (TiDB) ======
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: process.env.DB_PORT || 4000,
    user: process.env.DB_USER || 'your_user',
    password: process.env.DB_PASSWORD || 'your_password',
    database: process.env.DB_NAME || 'jayam_travels',
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ====== RAZORPAY INITIALIZATION ======
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_xxxxxxxxxx',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'xxxxxxxxxxxxxxxxxxxx'
});

// ====== EMAIL CONFIGURATION ======
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'jayamtravels@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
});

// ====== DATABASE INITIALIZATION ======
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();

        // Create bookings table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS bookings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                booking_id VARCHAR(50) UNIQUE NOT NULL,
                pnr VARCHAR(20) UNIQUE NOT NULL,
                from_city VARCHAR(100) NOT NULL,
                to_city VARCHAR(100) NOT NULL,
                travel_date DATE NOT NULL,
                seats JSON NOT NULL,
                passengers JSON NOT NULL,
                boarding VARCHAR(255) NOT NULL,
                dropping VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                mobile VARCHAR(20) NOT NULL,
                state VARCHAR(100) NOT NULL,
                insurance TINYINT(1) DEFAULT 0,
                base_fare DECIMAL(10,2) NOT NULL,
                cgst DECIMAL(10,2) NOT NULL,
                sgst DECIMAL(10,2) NOT NULL,
                service_fee DECIMAL(10,2) NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                payment_id VARCHAR(100),
                payment_status ENUM('pending', 'paid', 'failed') DEFAULT 'pending',
                booking_status ENUM('confirmed', 'cancelled', 'completed') DEFAULT 'confirmed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_booking_id (booking_id),
                INDEX idx_pnr (pnr),
                INDEX idx_email (email),
                INDEX idx_travel_date (travel_date)
            )
        `);

        // Create payments table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                booking_id VARCHAR(50) NOT NULL,
                razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
                razorpay_payment_id VARCHAR(100),
                razorpay_signature VARCHAR(255),
                amount DECIMAL(10,2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'INR',
                status VARCHAR(20) DEFAULT 'created',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
            )
        `);

        console.log('✅ Database initialized successfully');
        connection.release();
    } catch (error) {
        console.error('❌ Database initialization error:', error);
    }
}

// ====== HELPER FUNCTIONS ======
function generateBookingId() {
    return 'JAY' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function generatePNR() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let pnr = '';
    for (let i = 0; i < 10; i++) {
        pnr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pnr;
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

// ====== SEND CONFIRMATION EMAIL ======
async function sendConfirmationEmail(bookingData) {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER || 'jayamtravels@gmail.com',
            to: bookingData.email,
            subject: `Jayam Travels - Booking Confirmed (${bookingData.booking_id})`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa; border-radius: 10px;">
                    <div style="text-align: center; background: linear-gradient(135deg, #e63946, #f77f00); padding: 20px; border-radius: 10px 10px 0 0; color: #fff;">
                        <h1 style="margin: 0;">🚌 Jayam Travels</h1>
                        <p style="margin: 5px 0 0;">Booking Confirmed!</p>
                    </div>
                    <div style="background: #fff; padding: 20px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #e63946;">Booking Details</h2>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr><td style="padding: 8px 0;"><strong>Booking ID:</strong></td><td style="padding: 8px 0;">${bookingData.booking_id}</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>PNR:</strong></td><td style="padding: 8px 0;">${bookingData.pnr}</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Bus:</strong></td><td style="padding: 8px 0;">Jayam Travels - AC Sleeper</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Route:</strong></td><td style="padding: 8px 0;">${bookingData.from_city} → ${bookingData.to_city}</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Date:</strong></td><td style="padding: 8px 0;">${formatDate(bookingData.travel_date)}</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Boarding:</strong></td><td style="padding: 8px 0;">${bookingData.boarding}</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Dropping:</strong></td><td style="padding: 8px 0;">${bookingData.dropping}</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Seats:</strong></td><td style="padding: 8px 0;">${JSON.parse(bookingData.seats).join(', ')}</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Passengers:</strong></td><td style="padding: 8px 0;">
                                ${JSON.parse(bookingData.passengers).map(p => `${p.name} (${p.age} yrs, ${p.gender})`).join('<br>')}
                            </td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Total Amount:</strong></td><td style="padding: 8px 0; color: #e63946; font-weight: bold;">₹${bookingData.total_amount}</td></tr>
                        </table>
                        <hr style="border: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #666; font-size: 14px; text-align: center;">
                            <strong>Thank you for choosing Jayam Travels!</strong><br>
                            For any queries, contact us at support@jayamtravels.com or call 1800-XXX-XXXX
                        </p>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Confirmation email sent to ${bookingData.email}`);
        return true;
    } catch (error) {
        console.error('❌ Email sending error:', error);
        return false;
    }
}

// ====== API ROUTES ======

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Jayam Travels API is running' });
});

// ====== 1. CREATE BOOKING ======
app.post('/api/bookings', async (req, res) => {
    try {
        const {
            from, to, date, seats, passengers, boarding, dropping,
            email, mobile, state, insurance, base_fare, cgst, sgst, service_fee, total_amount
        } = req.body;

        // Validate required fields
        if (!from || !to || !date || !seats || !passengers || !boarding || !dropping || !email || !mobile || !state) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        // Validate mobile
        const mobileRegex = /^[6-9]\d{9}$/;
        if (!mobileRegex.test(mobile)) {
            return res.status(400).json({ error: 'Invalid mobile number' });
        }

        const booking_id = generateBookingId();
        const pnr = generatePNR();

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Insert booking
            const [result] = await connection.query(
                `INSERT INTO bookings (
                    booking_id, pnr, from_city, to_city, travel_date,
                    seats, passengers, boarding, dropping,
                    email, mobile, state, insurance,
                    base_fare, cgst, sgst, service_fee, total_amount,
                    payment_status, booking_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    booking_id, pnr, from, to, date,
                    JSON.stringify(seats), JSON.stringify(passengers), boarding, dropping,
                    email, mobile, state, insurance ? 1 : 0,
                    base_fare, cgst, sgst, service_fee, total_amount,
                    'pending', 'confirmed'
                ]
            );

            await connection.commit();

            // Send confirmation email (async, don't wait for it)
            const bookingData = {
                booking_id,
                pnr,
                from_city: from,
                to_city: to,
                travel_date: date,
                seats: JSON.stringify(seats),
                passengers: JSON.stringify(passengers),
                boarding,
                dropping,
                email,
                mobile,
                state,
                total_amount
            };
            sendConfirmationEmail(bookingData).catch(err => console.error('Email error:', err));

            res.status(201).json({
                success: true,
                booking_id,
                pnr,
                message: 'Booking created successfully'
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Booking creation error:', error);
        res.status(500).json({ error: 'Failed to create booking', details: error.message });
    }
});

// ====== 2. CREATE RAZORPAY ORDER ======
app.post('/api/create-order', async (req, res) => {
    try {
        const { booking_id, amount } = req.body;

        if (!booking_id || !amount) {
            return res.status(400).json({ error: 'Booking ID and amount are required' });
        }

        // Verify booking exists
        const connection = await pool.getConnection();
        const [bookings] = await connection.query(
            'SELECT booking_id, total_amount FROM bookings WHERE booking_id = ?',
            [booking_id]
        );
        connection.release();

        if (bookings.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const booking = bookings[0];
        if (booking.total_amount !== amount) {
            return res.status(400).json({ error: 'Amount mismatch' });
        }

        // Create Razorpay order
        const options = {
            amount: amount * 100, // Convert to paise
            currency: 'INR',
            receipt: booking_id,
            payment_capture: 1,
            notes: {
                booking_id: booking_id
            }
        };

        const order = await razorpay.orders.create(options);

        // Save order to database
        const conn = await pool.getConnection();
        await conn.query(
            'INSERT INTO payments (booking_id, razorpay_order_id, amount, currency, status) VALUES (?, ?, ?, ?, ?)',
            [booking_id, order.id, amount, 'INR', 'created']
        );
        conn.release();

        res.json({
            success: true,
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({ error: 'Failed to create payment order', details: error.message });
    }
});

// ====== 3. VERIFY PAYMENT ======
app.post('/api/verify-payment', async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            booking_id
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !booking_id) {
            return res.status(400).json({ error: 'Missing payment verification parameters' });
        }

        // Verify signature
        const sign = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest('hex');

        const isAuthentic = expectedSign === razorpay_signature;

        if (!isAuthentic) {
            return res.status(400).json({ error: 'Payment verification failed' });
        }

        // Update payment and booking status
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Update payment record
            await connection.query(
                `UPDATE payments 
                 SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'paid', updated_at = CURRENT_TIMESTAMP 
                 WHERE razorpay_order_id = ? AND booking_id = ?`,
                [razorpay_payment_id, razorpay_signature, razorpay_order_id, booking_id]
            );

            // Update booking payment status
            await connection.query(
                'UPDATE bookings SET payment_status = "paid", updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?',
                [booking_id]
            );

            await connection.commit();

            // Get booking details for confirmation
            const [bookings] = await connection.query(
                'SELECT * FROM bookings WHERE booking_id = ?',
                [booking_id]
            );

            connection.release();

            if (bookings.length > 0) {
                const booking = bookings[0];
                // Send confirmation email
                sendConfirmationEmail(booking).catch(err => console.error('Email error:', err));
            }

            res.json({
                success: true,
                message: 'Payment verified and booking confirmed',
                payment_id: razorpay_payment_id
            });

        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }

    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ error: 'Failed to verify payment', details: error.message });
    }
});

// ====== 4. GET BOOKING DETAILS ======
app.get('/api/bookings/:booking_id', async (req, res) => {
    try {
        const { booking_id } = req.params;

        const connection = await pool.getConnection();
        const [bookings] = await connection.query(
            'SELECT * FROM bookings WHERE booking_id = ?',
            [booking_id]
        );
        connection.release();

        if (bookings.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const booking = bookings[0];
        // Parse JSON fields
        booking.seats = JSON.parse(booking.seats);
        booking.passengers = JSON.parse(booking.passengers);

        res.json({ success: true, booking });

    } catch (error) {
        console.error('Get booking error:', error);
        res.status(500).json({ error: 'Failed to fetch booking details' });
    }
});

// ====== 5. GET BOOKINGS BY EMAIL ======
app.get('/api/bookings/email/:email', async (req, res) => {
    try {
        const { email } = req.params;

        const connection = await pool.getConnection();
        const [bookings] = await connection.query(
            'SELECT booking_id, pnr, from_city, to_city, travel_date, total_amount, payment_status, booking_status, created_at FROM bookings WHERE email = ? ORDER BY created_at DESC',
            [email]
        );
        connection.release();

        res.json({ success: true, bookings });

    } catch (error) {
        console.error('Get bookings by email error:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

// ====== 6. CANCEL BOOKING ======
app.post('/api/bookings/:booking_id/cancel', async (req, res) => {
    try {
        const { booking_id } = req.params;

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const [bookings] = await connection.query(
                'SELECT booking_status, payment_status FROM bookings WHERE booking_id = ?',
                [booking_id]
            );

            if (bookings.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({ error: 'Booking not found' });
            }

            const booking = bookings[0];
            if (booking.booking_status === 'cancelled') {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ error: 'Booking already cancelled' });
            }

            // Update booking status
            await connection.query(
                'UPDATE bookings SET booking_status = "cancelled", updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?',
                [booking_id]
            );

            await connection.commit();
            connection.release();

            res.json({ success: true, message: 'Booking cancelled successfully' });

        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }

    } catch (error) {
        console.error('Cancel booking error:', error);
        res.status(500).json({ error: 'Failed to cancel booking' });
    }
});

// ====== 7. WEBHOOK FOR RAZORPAY (Optional) ======
app.post('/api/webhook/razorpay', async (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'your_webhook_secret';
        const signature = req.headers['x-razorpay-signature'];

        // Verify webhook signature
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (signature !== expectedSignature) {
            return res.status(400).json({ error: 'Invalid webhook signature' });
        }

        const event = req.body.event;
        const payload = req.body.payload;

        if (event === 'payment.captured') {
            const payment = payload.payment.entity;
            const orderId = payment.order_id;
            const paymentId = payment.id;

            // Update payment status
            const connection = await pool.getConnection();
            await connection.query(
                'UPDATE payments SET razorpay_payment_id = ?, status = "paid", updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = ?',
                [paymentId, orderId]
            );

            // Get booking_id from payment
            const [payments] = await connection.query(
                'SELECT booking_id FROM payments WHERE razorpay_order_id = ?',
                [orderId]
            );

            if (payments.length > 0) {
                const booking_id = payments[0].booking_id;
                await connection.query(
                    'UPDATE bookings SET payment_status = "paid", updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?',
                    [booking_id]
                );

                // Send confirmation email
                const [bookings] = await connection.query(
                    'SELECT * FROM bookings WHERE booking_id = ?',
                    [booking_id]
                );
                if (bookings.length > 0) {
                    sendConfirmationEmail(bookings[0]).catch(err => console.error('Email error:', err));
                }
            }

            connection.release();
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// ====== START SERVER ======
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    await initializeDatabase();
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔑 Razorpay Key: ${process.env.RAZORPAY_KEY_ID ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`📧 Email: ${process.env.EMAIL_USER ? '✅ Configured' : '❌ Not configured'}`);
});

// ====== ERROR HANDLING ======
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

module.exports = app;