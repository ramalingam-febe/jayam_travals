// server.js - Jayam Travels Booking Backend (PROFESSIONAL VERSION)
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
app.use(cors({
    origin: ['http://localhost:5500', 'http://localhost:3000', 'https://yogajayam.netlify.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ====== VALIDATE ENVIRONMENT VARIABLES ======
function validateEnvironment() {
    const errors = [];
    const warnings = [];

    // Check Database
    if (!process.env.DB_HOST) errors.push('DB_HOST is not set');
    if (!process.env.DB_USER) errors.push('DB_USER is not set');
    if (!process.env.DB_PASSWORD) errors.push('DB_PASSWORD is not set');
    if (!process.env.DB_NAME) errors.push('DB_NAME is not set');

    // Check Razorpay (Critical for payments)
    if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID === 'rzp_test_xxxxxxxxxx') {
        errors.push('RAZORPAY_KEY_ID is not configured properly');
    }
    if (!process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET === 'xxxxxxxxxxxxxxxxxxxx') {
        errors.push('RAZORPAY_KEY_SECRET is not configured properly');
    }

    // Check Email (Warning only)
    if (!process.env.EMAIL_USER) warnings.push('EMAIL_USER is not set - Email notifications disabled');
    if (!process.env.EMAIL_PASS) warnings.push('EMAIL_PASS is not set - Email notifications disabled');

    // Check Environment
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'development') {
        warnings.push('NODE_ENV is not set - Defaulting to development');
    }

    return { errors, warnings };
}

// ====== VALIDATE RAZORPAY CONFIGURATION ======
function validateRazorpayConfig() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    // Check if keys exist and are not placeholder values
    if (!keyId || keyId === 'rzp_test_xxxxxxxxxx' || keyId.length < 10) {
        return { valid: false, error: 'Invalid Razorpay Key ID. Please set a valid key in .env' };
    }

    if (!keySecret || keySecret === 'xxxxxxxxxxxxxxxxxxxx' || keySecret.length < 10) {
        return { valid: false, error: 'Invalid Razorpay Key Secret. Please set a valid secret in .env' };
    }

    return { valid: true };
}

// ====== INITIALIZE RAZORPAY (with error handling) ======
let razorpay = null;
let razorpayInitialized = false;

function initializeRazorpay() {
    try {
        const validation = validateRazorpayConfig();
        if (!validation.valid) {
            console.error('❌ Razorpay initialization failed:', validation.error);
            razorpayInitialized = false;
            return false;
        }

        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
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

// ====== INITIALIZE EMAIL (with error handling) ======
let emailTransporter = null;
let emailInitialized = false;

function initializeEmail() {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.warn('⚠️ Email credentials not configured - Email notifications disabled');
            emailInitialized = false;
            return false;
        }

        emailTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        
        emailInitialized = true;
        console.log('✅ Email service initialized');
        return true;
    } catch (error) {
        console.error('❌ Email initialization error:', error.message);
        emailInitialized = false;
        return false;
    }
}

// ====== DATABASE CONNECTION ======
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 4000,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

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

function formatDate(date) {
    return new Date(date).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

// ====== SEND CONFIRMATION EMAIL ======
async function sendConfirmationEmail(bookingData) {
    if (!emailInitialized) {
        console.warn('⚠️ Email not initialized - Skipping email send');
        return false;
    }

    try {
        const seats = typeof bookingData.seats === 'string' ? JSON.parse(bookingData.seats) : bookingData.seats;
        const passengers = typeof bookingData.passengers === 'string' ? JSON.parse(bookingData.passengers) : bookingData.passengers;
        
        let passengerList = '';
        if (Array.isArray(passengers)) {
            passengers.forEach((p, i) => {
                const seat = Array.isArray(seats) ? seats[i] || 'N/A' : 'N/A';
                passengerList += `${p.name} (${p.age} yrs, ${p.gender}) - Seat: ${seat}<br>`;
            });
        }

        const mailOptions = {
            from: process.env.EMAIL_USER,
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
                            <tr><td style="padding: 8px 0;"><strong>Seats:</strong></td><td style="padding: 8px 0;">${Array.isArray(seats) ? seats.join(', ') : seats}</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Passengers:</strong></td><td style="padding: 8px 0;">${passengerList}</td></tr>
                            <tr><td style="padding: 8px 0;"><strong>Total Amount:</strong></td><td style="padding: 8px 0; color: #e63946; font-weight: bold;">₹${bookingData.total_amount}</td></tr>
                        </table>
                        <hr style="border: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #666; font-size: 14px; text-align: center;">
                            <strong>Thank you for choosing Jayam Travels!</strong><br>
                            For queries, contact: support@jayamtravels.com | 📞 1800-XXX-XXXX
                        </p>
                    </div>
                </div>
            `
        };

        await emailTransporter.sendMail(mailOptions);
        console.log(`✅ Confirmation email sent to ${bookingData.email}`);
        return true;
    } catch (error) {
        console.error('❌ Email sending error:', error.message);
        return false;
    }
}

// ====== CHECK DATABASE AND TABLES ======
async function checkDatabaseSetup() {
    let connection;
    try {
        connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        
        const [dbResult] = await connection.query('SELECT DATABASE() as current_db');
        const currentDb = dbResult[0].current_db;
        console.log(`📊 Current database: ${currentDb}`);
        
        const [tables] = await connection.query(
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('bookings', 'payments')",
            [currentDb]
        );
        
        const existingTables = tables.map(t => t.TABLE_NAME);
        
        if (existingTables.length < 2) {
            console.log('');
            console.log('⚠️ ════════════════════════════════════════════════════');
            console.log('⚠️  TABLES NOT FOUND! Please create them manually:');
            console.log('⚠️ ════════════════════════════════════════════════════');
            console.log('');
            console.log(`USE ${currentDb};`);
            console.log('');
            console.log('CREATE TABLE IF NOT EXISTS bookings (');
            console.log('    id INT AUTO_INCREMENT PRIMARY KEY,');
            console.log('    booking_id VARCHAR(50) UNIQUE NOT NULL,');
            console.log('    pnr VARCHAR(20) UNIQUE NOT NULL,');
            console.log('    from_city VARCHAR(100) NOT NULL,');
            console.log('    to_city VARCHAR(100) NOT NULL,');
            console.log('    travel_date DATE NOT NULL,');
            console.log('    seats JSON NOT NULL,');
            console.log('    passengers JSON NOT NULL,');
            console.log('    boarding VARCHAR(255) NOT NULL,');
            console.log('    dropping VARCHAR(255) NOT NULL,');
            console.log('    email VARCHAR(255) NOT NULL,');
            console.log('    mobile VARCHAR(20) NOT NULL,');
            console.log('    state VARCHAR(100) NOT NULL,');
            console.log('    insurance TINYINT(1) DEFAULT 0,');
            console.log('    base_fare DECIMAL(10,2) NOT NULL,');
            console.log('    cgst DECIMAL(10,2) NOT NULL,');
            console.log('    sgst DECIMAL(10,2) NOT NULL,');
            console.log('    service_fee DECIMAL(10,2) NOT NULL,');
            console.log('    total_amount DECIMAL(10,2) NOT NULL,');
            console.log('    payment_id VARCHAR(100),');
            console.log("    payment_status ENUM('pending', 'paid', 'failed') DEFAULT 'pending',");
            console.log("    booking_status ENUM('confirmed', 'cancelled', 'completed') DEFAULT 'confirmed',");
            console.log('    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,');
            console.log('    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,');
            console.log('    INDEX idx_booking_id (booking_id),');
            console.log('    INDEX idx_pnr (pnr),');
            console.log('    INDEX idx_email (email),');
            console.log('    INDEX idx_travel_date (travel_date)');
            console.log(');');
            console.log('');
            console.log('CREATE TABLE IF NOT EXISTS payments (');
            console.log('    id INT AUTO_INCREMENT PRIMARY KEY,');
            console.log('    booking_id VARCHAR(50) NOT NULL,');
            console.log('    razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,');
            console.log('    razorpay_payment_id VARCHAR(100),');
            console.log('    razorpay_signature VARCHAR(255),');
            console.log('    amount DECIMAL(10,2) NOT NULL,');
            console.log('    currency VARCHAR(10) DEFAULT "INR",');
            console.log("    status VARCHAR(20) DEFAULT 'created',");
            console.log('    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,');
            console.log('    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,');
            console.log('    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE');
            console.log(');');
            console.log('');
            console.log('⚠️ ════════════════════════════════════════════════════');
            console.log('');
            connection.release();
            return false;
        }
        
        console.log('✅ All tables exist');
        connection.release();
        return true;
        
    } catch (error) {
        console.error('❌ Database check error:', error.message);
        if (connection) connection.release();
        return false;
    }
}

// ====== ROOT ROUTE ======
app.get('/', (req, res) => {
    const envValidation = validateEnvironment();
    
    res.json({
        status: 'success',
        message: 'Jayam Travels API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: {
            node_env: process.env.NODE_ENV || 'development',
            razorpay: razorpayInitialized ? '✅ Configured' : '❌ Not Configured',
            email: emailInitialized ? '✅ Configured' : '❌ Not Configured',
            database: process.env.DB_NAME || 'Not Set'
        },
        endpoints: {
            health: 'GET /api/health',
            testDB: 'GET /api/test-db',
            bookings: 'POST /api/bookings',
            getBooking: 'GET /api/bookings/:booking_id',
            getBookingsByEmail: 'GET /api/bookings/email/:email',
            createOrder: 'POST /api/create-order',
            verifyPayment: 'POST /api/verify-payment',
            cancelBooking: 'POST /api/bookings/:booking_id/cancel',
            status: 'GET /api/status'
        }
    });
});

// ====== API STATUS (Check all services) ======
app.get('/api/status', (req, res) => {
    const envValidation = validateEnvironment();
    
    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        services: {
            database: {
                status: 'connected',
                name: process.env.DB_NAME || 'Not Set'
            },
            razorpay: {
                status: razorpayInitialized ? 'configured' : 'not_configured',
                message: razorpayInitialized ? 'Razorpay is ready' : 'Razorpay keys not configured'
            },
            email: {
                status: emailInitialized ? 'configured' : 'not_configured',
                message: emailInitialized ? 'Email service is ready' : 'Email credentials not configured'
            }
        },
        environment: {
            node_env: process.env.NODE_ENV || 'development',
            port: PORT
        },
        warnings: envValidation.warnings,
        errors: envValidation.errors
    });
});

// ====== HEALTH CHECK ======
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Jayam Travels API is running',
        timestamp: new Date().toISOString(),
        services: {
            razorpay: razorpayInitialized ? 'ready' : 'not_configured',
            email: emailInitialized ? 'ready' : 'not_configured'
        }
    });
});

// ====== TEST DATABASE ======
app.get('/api/test-db', async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        
        const [dbResult] = await connection.query('SELECT DATABASE() as current_db');
        const currentDb = dbResult[0].current_db;
        
        const [tables] = await connection.query(
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
            [currentDb]
        );
        
        connection.release();
        
        res.json({
            success: true,
            message: 'Database connected successfully',
            current_database: currentDb,
            tables: tables.map(t => t.TABLE_NAME),
            database_config: process.env.DB_NAME
        });
    } catch (error) {
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            message: 'Database connection failed',
            error: error.message
        });
    }
});

// ====== 1. CREATE BOOKING ======
app.post('/api/bookings', async (req, res) => {
    let connection;
    try {
        console.log('========================================');
        console.log('📝 CREATE BOOKING REQUEST');
        console.log('========================================');
        
        const {
            from, to, date, seats, passengers, boarding, dropping,
            email, mobile, state, insurance, base_fare, cgst, sgst, service_fee, total_amount
        } = req.body;

        // ====== VALIDATION ======
        const requiredFields = ['from', 'to', 'date', 'seats', 'passengers', 'boarding', 'dropping', 'email', 'mobile', 'state'];
        const missingFields = requiredFields.filter(field => !req.body[field]);
        
        if (missingFields.length > 0) {
            return res.status(400).json({ 
                success: false,
                error: 'Missing required fields',
                missing: missingFields
            });
        }

        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid email address' 
            });
        }

        // Validate mobile
        const mobileRegex = /^[6-9]\d{9}$/;
        if (!mobileRegex.test(mobile)) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid mobile number' 
            });
        }

        // Validate seats
        if (!Array.isArray(seats) || seats.length === 0) {
            return res.status(400).json({ 
                success: false,
                error: 'Seats must be a non-empty array' 
            });
        }

        // Validate passengers
        if (!Array.isArray(passengers) || passengers.length === 0) {
            return res.status(400).json({ 
                success: false,
                error: 'Passengers must be a non-empty array' 
            });
        }

        // Check if passengers match seats
        if (seats.length !== passengers.length) {
            return res.status(400).json({ 
                success: false,
                error: 'Number of seats and passengers must match' 
            });
        }

        // ====== CHECK RAZORPAY CONFIGURATION ======
        if (!razorpayInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Payment service is not configured',
                message: 'Razorpay keys are not properly configured. Please contact support.',
                details: 'Payment gateway is required for booking'
            });
        }

        // Generate IDs
        const booking_id = generateBookingId();
        const pnr = generatePNR();

        // Database operation
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

        // Send email in background (only if email is configured)
        if (emailInitialized) {
            const bookingData = {
                booking_id, pnr, from_city: from, to_city: to,
                travel_date: date, seats: seatsJson, passengers: passengersJson,
                boarding, dropping, email, mobile, state,
                total_amount
            };
            sendConfirmationEmail(bookingData).catch(err => {
                console.error('❌ Email error:', err.message);
            });
        }

        console.log('✅ Booking created successfully:', booking_id);
        res.status(201).json({
            success: true,
            booking_id: booking_id,
            pnr: pnr,
            message: 'Booking created successfully',
            payment_required: true,
            razorpay_ready: razorpayInitialized
        });

    } catch (error) {
        console.error('❌ Booking error:', error.message);
        if (connection) {
            try {
                await connection.rollback();
                console.log('🔄 Transaction rolled back');
            } catch (rollbackError) {
                console.error('❌ Rollback error:', rollbackError.message);
            }
            connection.release();
        }
        res.status(500).json({ 
            success: false,
            error: 'Failed to create booking',
            details: error.message
        });
    }
});

// ====== 2. CREATE RAZORPAY ORDER ======
app.post('/api/create-order', async (req, res) => {
    let connection;
    try {
        // ====== CHECK RAZORPAY CONFIGURATION ======
        if (!razorpayInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Payment service is not configured',
                message: 'Razorpay keys are not properly configured'
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

        // Create Razorpay order
        const options = {
            amount: Math.round(amount * 100),
            currency: 'INR',
            receipt: booking_id,
            payment_capture: 1,
            notes: { booking_id: booking_id }
        };

        const order = await razorpay.orders.create(options);
        console.log('✅ Razorpay order created:', order.id);

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
            key_id: process.env.RAZORPAY_KEY_ID
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

// ====== 3. VERIFY PAYMENT ======
app.post('/api/verify-payment', async (req, res) => {
    let connection;
    try {
        // ====== CHECK RAZORPAY CONFIGURATION ======
        if (!razorpayInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Payment service is not configured'
            });
        }

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

        // Verify signature
        const sign = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest('hex');

        const isAuthentic = expectedSign === razorpay_signature;

        if (!isAuthentic) {
            return res.status(400).json({ 
                success: false,
                error: 'Payment verification failed - Invalid signature' 
            });
        }

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

        // Send confirmation email
        if (bookings.length > 0 && emailInitialized) {
            sendConfirmationEmail(bookings[0]).catch(err => {
                console.error('❌ Email error:', err.message);
            });
        }

        res.json({
            success: true,
            message: 'Payment verified and booking confirmed',
            payment_id: razorpay_payment_id
        });

    } catch (error) {
        console.error('❌ Payment verification error:', error.message);
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('❌ Rollback error:', rollbackError.message);
            }
            connection.release();
        }
        res.status(500).json({ 
            success: false,
            error: 'Failed to verify payment', 
            details: error.message 
        });
    }
});

// ====== 4. GET BOOKING DETAILS ======
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
            error: 'Failed to fetch booking details' 
        });
    }
});

// ====== 5. GET BOOKINGS BY EMAIL ======
app.get('/api/bookings/email/:email', async (req, res) => {
    let connection;
    try {
        const { email } = req.params;

        connection = await pool.getConnection();
        const [bookings] = await connection.query(
            `SELECT booking_id, pnr, from_city, to_city, travel_date, 
                    total_amount, payment_status, booking_status, created_at 
             FROM bookings WHERE email = ? ORDER BY created_at DESC`,
            [email]
        );
        connection.release();

        res.json({ success: true, bookings });

    } catch (error) {
        console.error('❌ Get bookings by email error:', error.message);
        if (connection) connection.release();
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch bookings' 
        });
    }
});

// ====== 6. CANCEL BOOKING ======
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
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('❌ Rollback error:', rollbackError.message);
            }
            connection.release();
        }
        res.status(500).json({ 
            success: false,
            error: 'Failed to cancel booking' 
        });
    }
});

// ====== 404 HANDLER ======
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.url,
        method: req.method
    });
});

// ====== ERROR HANDLER ======
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err.message);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});

// ====== START SERVER ======
app.listen(PORT, async () => {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║   🚌 Jayam Travels - Professional Backend       ║');
    console.log('╠═══════════════════════════════════════════════════╣');
    console.log(`║   Server running on port: ${PORT}                ║`);
    console.log(`║   Environment: ${process.env.NODE_ENV || 'development'}                 ║`);
    console.log('╠═══════════════════════════════════════════════════╣');
    
    // Validate environment
    const envValidation = validateEnvironment();
    if (envValidation.errors.length > 0) {
        console.log('║   ❌ CRITICAL ERRORS:                         ║');
        envValidation.errors.forEach(err => {
            console.log(`║      - ${err}                               ║`);
        });
    }
    if (envValidation.warnings.length > 0) {
        console.log('║   ⚠️  Warnings:                               ║');
        envValidation.warnings.forEach(warn => {
            console.log(`║      - ${warn}                               ║`);
        });
    }
    
    console.log('╠═══════════════════════════════════════════════════╣');
    
    // Initialize Razorpay
    const razorpayOk = initializeRazorpay();
    console.log(`║   Razorpay: ${razorpayOk ? '✅ Configured' : '❌ NOT CONFIGURED'}`);
    
    // Initialize Email
    const emailOk = initializeEmail();
    console.log(`║   Email: ${emailOk ? '✅ Configured' : '⚠️  Disabled'}`);
    
    console.log('╠═══════════════════════════════════════════════════╣');
    
    // Check database
    const dbOk = await checkDatabaseSetup();
    console.log(`║   Database: ${dbOk ? '✅ Connected' : '❌ Check tables'}`);
    
    console.log('╠═══════════════════════════════════════════════════╣');
    console.log(`║   Status URL: http://localhost:${PORT}/api/status ║`);
    console.log('╚═══════════════════════════════════════════════════╝');
});

// ====== UNHANDLED REJECTIONS ======
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error.message);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
});

module.exports = app;
