// server.js - Fixed version with email disabled for now
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();

// ====== CORS CONFIGURATION ======
const allowedOrigins = [
    'https://yogajayam.netlify.app',
    'https://jayam-travels.netlify.app',
    'http://localhost:5500',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'https://*.onrender.com',
    'https://*.netlify.app'
];

app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
        if (origin.includes('.netlify.app')) return callback(null, true);
        if (origin.includes('.onrender.com')) return callback(null, true);
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ====== RAZORPAY CONFIGURATION ======
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║   🚌 Jayam Travels - Backend Server             ║');
console.log('╠═══════════════════════════════════════════════════╣');
console.log(`║   Razorpay Key: ${RAZORPAY_KEY_ID}`);
console.log(`║   Mode: ${RAZORPAY_KEY_ID && RAZORPAY_KEY_ID.startsWith('rzp_test') ? '🔬 TEST' : '🚀 LIVE'}`);
console.log('╚═══════════════════════════════════════════════════╝');

// ====== DATABASE CONNECTION ======
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: process.env.DB_PORT || 4000,
    user: process.env.DB_USER || '2bEem2Bk4wszYxL.ramrat_2isqLHvC',
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
let razorpay = null;
let razorpayInitialized = false;

function initializeRazorpay() {
    try {
        if (!RAZORPAY_KEY_ID || RAZORPAY_KEY_ID.length < 10) {
            console.error('❌ Invalid Razorpay Key ID');
            razorpayInitialized = false;
            return false;
        }

        if (!RAZORPAY_KEY_SECRET || RAZORPAY_KEY_SECRET.length < 10) {
            console.error('❌ Invalid Razorpay Key Secret');
            razorpayInitialized = false;
            return false;
        }

        razorpay = new Razorpay({
            key_id: RAZORPAY_KEY_ID,
            key_secret: RAZORPAY_KEY_SECRET
        });
        
        razorpayInitialized = true;
        console.log('✅ Razorpay initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Razorpay initialization error:', error.message);
        razorpayInitialized = false;
        return false;
    }
}

// ====== EMAIL INITIALIZATION (DISABLED) ======
let emailInitialized = false;

function initializeEmail() {
    // Email is disabled to prevent timeout errors
    console.log('⚠️ Email notifications disabled (connection timeout)');
    emailInitialized = false;
    return false;
}

// ====== HELPER FUNCTIONS ======
function generateBookingId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'JAY' + timestamp + random;
}

function generatePNR() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let pnr = '';
    for (let i = 0; i < 10; i++) {
        pnr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pnr;
}

// ====== SEND CONFIRMATION EMAIL (DISABLED) ======
async function sendConfirmationEmail(bookingData) {
    console.log(`⚠️ Email disabled - Skipping email to ${bookingData.email}`);
    return { success: false, error: 'Email service disabled' };
}

// ====== CHECK DATABASE ======
async function checkDatabaseSetup() {
    let connection;
    try {
        connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        
        const [dbResult] = await connection.query('SELECT DATABASE() as current_db');
        console.log(`📊 Current database: ${dbResult[0].current_db}`);
        
        const [tables] = await connection.query(
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('bookings', 'payments')",
            [dbResult[0].current_db]
        );
        
        if (tables.length < 2) {
            console.log('⚠️ Tables not found. Please create them manually.');
            connection.release();
            return false;
        }
        
        console.log('✅ All tables exist');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database error:', error.message);
        if (connection) connection.release();
        return false;
    }
}

// ====== API ROUTES ======

// Root route
app.get('/', (req, res) => {
    const isTest = RAZORPAY_KEY_ID && RAZORPAY_KEY_ID.startsWith('rzp_test');
    res.json({
        status: 'success',
        message: 'Jayam Travels API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        razorpay_key: RAZORPAY_KEY_ID,
        mode: isTest ? 'TEST' : 'LIVE',
        email_enabled: false,
        test_instructions: isTest ? {
            card: '4242 4242 4242 4242',
            expiry: '12/25',
            cvv: '123',
            otp: '1221'
        } : null
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API is running',
        timestamp: new Date().toISOString()
    });
});

// Status check
app.get('/api/status', (req, res) => {
    const isTest = RAZORPAY_KEY_ID && RAZORPAY_KEY_ID.startsWith('rzp_test');
    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        razorpay_mode: isTest ? 'TEST' : 'LIVE',
        razorpay_initialized: razorpayInitialized,
        email_enabled: emailInitialized,
        test_card: isTest ? '4242 4242 4242 4242' : null,
        test_otp: isTest ? '1221' : null
    });
});

// ====== CREATE BOOKING ======
app.post('/api/bookings', async (req, res) => {
    let connection;
    try {
        console.log('📝 Creating booking...');
        
        const {
            from, to, date, seats, passengers, boarding, dropping,
            email, mobile, state, insurance, base_fare, cgst, sgst, service_fee, total_amount
        } = req.body;

        const requiredFields = ['from', 'to', 'date', 'seats', 'passengers', 'boarding', 'dropping', 'email', 'mobile', 'state'];
        const missingFields = requiredFields.filter(field => !req.body[field]);
        
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                missing: missingFields
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, error: 'Invalid email address' });
        }

        const mobileRegex = /^[6-9]\d{9}$/;
        if (!mobileRegex.test(mobile)) {
            return res.status(400).json({ success: false, error: 'Invalid mobile number' });
        }

        if (!razorpayInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Payment service not configured'
            });
        }

        const booking_id = generateBookingId();
        const pnr = generatePNR();

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const seatsJson = JSON.stringify(seats);
        const passengersJson = JSON.stringify(passengers);
        const insuranceValue = insurance ? 1 : 0;

        const query = `
            INSERT INTO bookings (
                booking_id, pnr, from_city, to_city, travel_date,
                seats, passengers, boarding, dropping,
                email, mobile, state, insurance,
                base_fare, cgst, sgst, service_fee, total_amount,
                payment_status, booking_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            booking_id, pnr, from, to, date,
            seatsJson, passengersJson, boarding, dropping,
            email, mobile, state, insuranceValue,
            base_fare, cgst, sgst, service_fee, total_amount,
            'pending', 'confirmed'
        ];

        await connection.query(query, values);
        await connection.commit();

        console.log('✅ Booking created:', booking_id);

        res.status(201).json({
            success: true,
            booking_id: booking_id,
            pnr: pnr,
            message: 'Booking created successfully'
        });

    } catch (error) {
        console.error('❌ Booking error:', error.message);
        if (connection) {
            try { await connection.rollback(); } catch (e) {}
            connection.release();
        }
        res.status(500).json({
            success: false,
            error: 'Failed to create booking',
            details: error.message
        });
    }
});

// ====== CREATE RAZORPAY ORDER ======
app.post('/api/create-order', async (req, res) => {
    let connection;
    try {
        console.log('📝 Creating Razorpay order...');

        if (!razorpayInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Payment service not configured'
            });
        }

        const { booking_id, amount } = req.body;

        if (!booking_id || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Booking ID and amount are required'
            });
        }

        connection = await pool.getConnection();
        const [bookings] = await connection.query(
            'SELECT booking_id, total_amount FROM bookings WHERE booking_id = ?',
            [booking_id]
        );

        if (bookings.length === 0) {
            connection.release();
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }

        const booking = bookings[0];
        if (parseFloat(booking.total_amount) !== parseFloat(amount)) {
            connection.release();
            return res.status(400).json({
                success: false,
                error: 'Amount mismatch'
            });
        }

        const options = {
            amount: Math.round(amount * 100),
            currency: 'INR',
            receipt: booking_id,
            payment_capture: 1,
            notes: { 
                booking_id: booking_id,
                booking_pnr: booking.pnr || 'N/A'
            }
        };

        console.log('📝 Order Options:', JSON.stringify(options, null, 2));

        const order = await razorpay.orders.create(options);
        console.log(`✅ Razorpay order created: ${order.id}`);
        console.log(`   Amount: ₹${amount}`);
        console.log(`   Currency: ${order.currency}`);

        await connection.query(
            'INSERT INTO payments (booking_id, razorpay_order_id, amount, currency, status) VALUES (?, ?, ?, ?, ?)',
            [booking_id, order.id, amount, 'INR', 'created']
        );

        connection.release();

        res.json({
            success: true,
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error('❌ Order creation error:', error.message);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            error: 'Failed to create payment order',
            details: error.message
        });
    }
});

// ====== VERIFY PAYMENT ======
app.post('/api/verify-payment', async (req, res) => {
    let connection;
    try {
        console.log('📝 Verifying payment...');

        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            booking_id
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !booking_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing payment verification parameters'
            });
        }

        const sign = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest('hex');

        if (expectedSign !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                error: 'Payment verification failed - Invalid signature'
            });
        }

        console.log('✅ Signature verified successfully');

        connection = await pool.getConnection();
        await connection.beginTransaction();

        await connection.query(
            `UPDATE payments 
             SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'paid', updated_at = CURRENT_TIMESTAMP 
             WHERE razorpay_order_id = ? AND booking_id = ?`,
            [razorpay_payment_id, razorpay_signature, razorpay_order_id, booking_id]
        );

        await connection.query(
            'UPDATE bookings SET payment_status = "paid", updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?',
            [booking_id]
        );

        await connection.commit();

        const [bookings] = await connection.query(
            'SELECT * FROM bookings WHERE booking_id = ?',
            [booking_id]
        );

        connection.release();

        console.log('✅ Payment verified and booking confirmed');

        res.json({
            success: true,
            message: 'Payment verified and booking confirmed',
            payment_id: razorpay_payment_id
        });

    } catch (error) {
        console.error('❌ Payment verification error:', error.message);
        if (connection) {
            try { await connection.rollback(); } catch (e) {}
            connection.release();
        }
        res.status(500).json({
            success: false,
            error: 'Failed to verify payment',
            details: error.message
        });
    }
});

// ====== GET BOOKING ======
app.get('/api/bookings/:booking_id', async (req, res) => {
    let connection;
    try {
        const { booking_id } = req.params;

        connection = await pool.getConnection();
        const [bookings] = await connection.query(
            'SELECT * FROM bookings WHERE booking_id = ?',
            [booking_id]
        );
        connection.release();

        if (bookings.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }

        const booking = bookings[0];
        booking.seats = JSON.parse(booking.seats);
        booking.passengers = JSON.parse(booking.passengers);

        res.json({ success: true, booking });

    } catch (error) {
        console.error('❌ Get booking error:', error.message);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            error: 'Failed to fetch booking'
        });
    }
});

// ====== GET BOOKINGS BY EMAIL ======
app.get('/api/bookings/email/:email', async (req, res) => {
    let connection;
    try {
        const { email } = req.params;

        connection = await pool.getConnection();
        const [bookings] = await connection.query(
            'SELECT * FROM bookings WHERE email = ? ORDER BY created_at DESC',
            [email]
        );
        connection.release();

        res.json({ success: true, bookings });

    } catch (error) {
        console.error('❌ Get bookings error:', error.message);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            error: 'Failed to fetch bookings'
        });
    }
});

// ====== CANCEL BOOKING ======
app.post('/api/bookings/:booking_id/cancel', async (req, res) => {
    let connection;
    try {
        const { booking_id } = req.params;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [bookings] = await connection.query(
            'SELECT booking_status FROM bookings WHERE booking_id = ?',
            [booking_id]
        );

        if (bookings.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }

        if (bookings[0].booking_status === 'cancelled') {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                error: 'Booking already cancelled'
            });
        }

        await connection.query(
            'UPDATE bookings SET booking_status = "cancelled", updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?',
            [booking_id]
        );

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: 'Booking cancelled successfully'
        });

    } catch (error) {
        console.error('❌ Cancel booking error:', error.message);
        if (connection) {
            try { await connection.rollback(); } catch (e) {}
            connection.release();
        }
        res.status(500).json({
            success: false,
            error: 'Failed to cancel booking'
        });
    }
});

// ====== START SERVER ======
app.listen(PORT, async () => {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║   🚌 Jayam Travels - Backend Server             ║');
    console.log('╠═══════════════════════════════════════════════════╣');
    console.log(`║   Server running on port: ${PORT}                ║`);
    console.log('╠═══════════════════════════════════════════════════╣');

    initializeRazorpay();
    initializeEmail();
    await checkDatabaseSetup();

    const isTest = RAZORPAY_KEY_ID && RAZORPAY_KEY_ID.startsWith('rzp_test');
    console.log('╠═══════════════════════════════════════════════════╣');
    console.log(`║   Razorpay Mode: ${isTest ? '🔬 TEST' : '🚀 LIVE'}`);
    console.log(`║   Email: ${emailInitialized ? '✅ Configured' : '⚠️ Disabled'}`);
    console.log(`║   Database: ${process.env.DB_NAME || 'Not Set'}`);
    console.log('╠═══════════════════════════════════════════════════╣');
    
    if (isTest) {
        console.log('║   📝 TEST MODE - Use these test cards:        ║');
        console.log('║   💳 Card: 4242 4242 4242 4242               ║');
        console.log('║   📅 Expiry: 12/25 (Any future date)         ║');
        console.log('║   🔢 CVV: 123 (Any 3 digits)                ║');
        console.log('║   📱 OTP: 1221                               ║');
    }
    console.log('╚═══════════════════════════════════════════════════╝');
});

module.exports = app;
