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
    origin: ['http://localhost:5500', 'http://localhost:3000', 'https://app.netlify.com'],
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

    return { errors, warnings };
}

// ====== VALIDATE RAZORPAY CONFIGURATION ======
function validateRazorpayConfig() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || keyId === 'rzp_test_xxxxxxxxxx' || keyId.length < 10) {
        return { valid: false, error: 'Invalid Razorpay Key ID. Please set a valid key in .env' };
    }

    if (!keySecret || keySecret === 'xxxxxxxxxxxxxxxxxxxx' || keySecret.length < 10) {
        return { valid: false, error: 'Invalid Razorpay Key Secret. Please set a valid secret in .env' };
    }

    return { valid: true };
}

// ====== INITIALIZE RAZORPAY ======
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

// ====== INITIALIZE EMAIL ======
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
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 10000
        });

        // Verify connection
        emailTransporter.verify(function(error, success) {
            if (error) {
                console.error('❌ Email verification failed:', error.message);
                emailInitialized = false;
            } else {
                console.log('✅ Email service ready to send emails');
                emailInitialized = true;
            }
        });

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
        return { success: false, error: 'Email service not configured' };
    }

    try {
        const seats = typeof bookingData.seats === 'string' ? JSON.parse(bookingData.seats) : bookingData.seats;
        const passengers = typeof bookingData.passengers === 'string' ? JSON.parse(bookingData.passengers) : bookingData.passengers;
        
        let passengerList = '';
        if (Array.isArray(passengers)) {
            passengers.forEach((p, i) => {
                const seat = Array.isArray(seats) ? seats[i] || 'N/A' : 'N/A';
                passengerList += `
                    <tr>
                        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 13px;">${i + 1}</td>
                        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 13px;">${p.name}</td>
                        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 13px;">${p.age} yrs</td>
                        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 13px;">${p.gender}</td>
                        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 13px; font-weight: bold; color: #e63946;">${seat}</td>
                    </tr>
                `;
            });
        }

        const mailOptions = {
            from: `"Jayam Travels" <${process.env.EMAIL_USER}>`,
            to: bookingData.email,
            cc: process.env.EMAIL_USER,
            subject: `🎫 Jayam Travels - Booking Confirmed (${bookingData.booking_id})`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Booking Confirmation</title>
                </head>
                <body style="font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px;">
                    <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden;">
                        
                        <!-- HEADER -->
                        <div style="background: linear-gradient(135deg, #e63946, #f77f00); padding: 25px 20px; text-align: center; color: #fff;">
                            <h1 style="margin: 0; font-size: 26px;">🚌 Jayam Travels</h1>
                            <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">Booking Confirmed!</p>
                        </div>

                        <!-- BODY -->
                        <div style="padding: 25px 20px;">
                            <h2 style="color: #1a1a2e; margin: 0 0 15px; font-size: 20px;">Thank you for booking!</h2>
                            <p style="color: #666; margin-bottom: 15px; font-size: 14px;">Your bus ticket has been confirmed. Please find your booking details below.</p>

                            <!-- Booking Details -->
                            <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 15px;">
                                <h3 style="color: #e63946; margin: 0 0 12px; font-size: 15px;">📋 Booking Details</h3>
                                <table style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>Booking ID:</strong></td>
                                        <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #e63946; font-size: 13px;">${bookingData.booking_id}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>PNR:</strong></td>
                                        <td style="padding: 6px 0; text-align: right; font-weight: bold; font-size: 13px;">${bookingData.pnr}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>Bus:</strong></td>
                                        <td style="padding: 6px 0; text-align: right; font-size: 13px;">Jayam Travels - AC Sleeper (Volvo)</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>Route:</strong></td>
                                        <td style="padding: 6px 0; text-align: right; font-weight: 600; font-size: 13px;">${bookingData.from_city} → ${bookingData.to_city}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>Date:</strong></td>
                                        <td style="padding: 6px 0; text-align: right; font-size: 13px;">${formatDate(bookingData.travel_date)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>Boarding:</strong></td>
                                        <td style="padding: 6px 0; text-align: right; font-size: 13px;">${bookingData.boarding}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 6px 0; color: #666; font-size: 13px;"><strong>Dropping:</strong></td>
                                        <td style="padding: 6px 0; text-align: right; font-size: 13px;">${bookingData.dropping}</td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Passenger Details -->
                            <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 15px;">
                                <h3 style="color: #e63946; margin: 0 0 12px; font-size: 15px;">👤 Passenger Details</h3>
                                <table style="width: 100%; border-collapse: collapse;">
                                    <thead>
                                        <tr style="background: #e9ecef;">
                                            <th style="padding: 6px 8px; text-align: left; font-size: 11px;">#</th>
                                            <th style="padding: 6px 8px; text-align: left; font-size: 11px;">Name</th>
                                            <th style="padding: 6px 8px; text-align: left; font-size: 11px;">Age</th>
                                            <th style="padding: 6px 8px; text-align: left; font-size: 11px;">Gender</th>
                                            <th style="padding: 6px 8px; text-align: left; font-size: 11px;">Seat</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${passengerList}
                                    </tbody>
                                </table>
                            </div>

                            <!-- Fare Breakup -->
                            <div style="background: #fff8f0; padding: 16px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #f77f00;">
                                <h3 style="color: #e63946; margin: 0 0 12px; font-size: 15px;">💰 Fare Breakup</h3>
                                <table style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 5px 0; color: #666; font-size: 13px;">Base Fare</td>
                                        <td style="padding: 5px 0; text-align: right; font-size: 13px;">₹${bookingData.base_fare || 0}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px 0; color: #666; font-size: 13px;">CGST (2.5%)</td>
                                        <td style="padding: 5px 0; text-align: right; font-size: 13px;">₹${bookingData.cgst || 0}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px 0; color: #666; font-size: 13px;">SGST (2.5%)</td>
                                        <td style="padding: 5px 0; text-align: right; font-size: 13px;">₹${bookingData.sgst || 0}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px 0; color: #666; font-size: 13px;">Service Fee</td>
                                        <td style="padding: 5px 0; text-align: right; font-size: 13px;">₹${bookingData.service_fee || 15}</td>
                                    </tr>
                                    <tr style="border-top: 2px solid #ddd; font-weight: bold; font-size: 17px;">
                                        <td style="padding: 8px 0 0; color: #1a1a2e; font-size: 15px;">Total Amount</td>
                                        <td style="padding: 8px 0 0; text-align: right; color: #e63946; font-size: 15px;">₹${bookingData.total_amount}</td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Important Information -->
                            <div style="background: #e8f5e9; padding: 14px; border-radius: 8px; border-left: 4px solid #06A77D; margin-bottom: 15px;">
                                <p style="margin: 0; color: #1a1a2e; font-size: 13px;">
                                    <strong>✅ Important:</strong>
                                    <br>
                                    • Please carry a valid ID proof (Aadhar, PAN, Driving License)
                                    <br>
                                    • Arrive at the boarding point 30 minutes before departure
                                    <br>
                                    • Show this email or SMS at the time of boarding
                                    <br>
                                    • For queries: support@jayamtravels.com | 1800-XXX-XXXX
                                </p>
                            </div>

                            <!-- Footer -->
                            <div style="text-align: center; padding-top: 16px; border-top: 1px solid #eee; color: #999; font-size: 11px;">
                                <p style="margin: 0;">Thank you for choosing Jayam Travels!</p>
                                <p style="margin: 5px 0 0;">This is a system generated email. Please do not reply.</p>
                                <p style="margin: 5px 0 0;">© ${new Date().getFullYear()} Jayam Travels. All rights reserved.</p>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
                Jayam Travels - Booking Confirmed (${bookingData.booking_id})

                Thank you for booking with Jayam Travels!

                Booking Details:
                -----------------
                Booking ID: ${bookingData.booking_id}
                PNR: ${bookingData.pnr}
                Bus: Jayam Travels - AC Sleeper (Volvo)
                Route: ${bookingData.from_city} → ${bookingData.to_city}
                Date: ${formatDate(bookingData.travel_date)}
                Boarding: ${bookingData.boarding}
                Dropping: ${bookingData.dropping}
                Total Amount: ₹${bookingData.total_amount}

                Passengers:
                ${passengers.map((p, i) => `  ${i+1}. ${p.name} (${p.age} yrs, ${p.gender}) - Seat: ${seats[i]}`).join('\n')}

                Important Instructions:
                - Carry valid ID proof
                - Arrive 30 minutes before departure
                - Show this email at boarding

                For queries: support@jayamtravels.com | 1800-XXX-XXXX

                © ${new Date().getFullYear()} Jayam Travels
            `
        };

        const info = await emailTransporter.sendMail(mailOptions);
        console.log(`✅ Confirmation email sent to ${bookingData.email}`);
        console.log(`📧 Message ID: ${info.messageId}`);
        
        return { 
            success: true, 
            messageId: info.messageId,
            recipient: bookingData.email 
        };

    } catch (error) {
        console.error('❌ Email sending error:', error.message);
        return { 
            success: false, 
            error: error.message 
        };
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
        services: {
            razorpay: razorpayInitialized ? '✅ Configured' : '❌ Not Configured',
            email: emailInitialized ? '✅ Configured' : '❌ Not Configured',
            database: process.env.DB_NAME || 'Not Set'
        },
        endpoints: {
            health: 'GET /api/health',
            testDB: 'GET /api/test-db',
            status: 'GET /api/status',
            bookings: 'POST /api/bookings',
            getBooking: 'GET /api/bookings/:booking_id',
            getBookingsByEmail: 'GET /api/bookings/email/:email',
            createOrder: 'POST /api/create-order',
            verifyPayment: 'POST /api/verify-payment',
            cancelBooking: 'POST /api/bookings/:booking_id/cancel'
        }
    });
});

// ====== API STATUS ======
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
        timestamp: new Date().toISOString()
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
                message: 'Razorpay keys are not properly configured. Please contact support.'
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

        console.log('✅ Booking created successfully:', booking_id);
        
        // Return booking data without waiting for email
        res.status(201).json({
            success: true,
            booking_id: booking_id,
            pnr: pnr,
            message: 'Booking created successfully',
            payment_required: true
        });

        // ====== SEND EMAIL IN BACKGROUND (Async) ======
        if (emailInitialized) {
            const bookingData = {
                booking_id, pnr, from_city: from, to_city: to,
                travel_date: date, seats: seatsJson, passengers: passengersJson,
                boarding, dropping, email, mobile, state,
                total_amount, base_fare, cgst, sgst, service_fee
            };
            
            // Send email after 2 minutes delay
            setTimeout(async () => {
                console.log(`⏳ Sending confirmation email to ${email} (after 2 min delay)`);
                const result = await sendConfirmationEmail(bookingData);
                if (result.success) {
                    console.log(`✅ Confirmation email sent to ${email}`);
                } else {
                    console.error(`❌ Failed to send email to ${email}:`, result.error);
                }
            }, 120000); // 2 minutes delay
        }

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

        // ====== SEND CONFIRMATION EMAIL AFTER PAYMENT ======
        if (bookings.length > 0 && emailInitialized) {
            const booking = bookings[0];
            // Parse JSON fields
            booking.seats = JSON.parse(booking.seats);
            booking.passengers = JSON.parse(booking.passengers);
            
            const bookingData = {
                booking_id: booking.booking_id,
                pnr: booking.pnr,
                from_city: booking.from_city,
                to_city: booking.to_city,
                travel_date: booking.travel_date,
                seats: JSON.stringify(booking.seats),
                passengers: JSON.stringify(booking.passengers),
                boarding: booking.boarding,
                dropping: booking.dropping,
                email: booking.email,
                mobile: booking.mobile,
                state: booking.state,
                total_amount: booking.total_amount,
                base_fare: booking.base_fare,
                cgst: booking.cgst,
                sgst: booking.sgst,
                service_fee: booking.service_fee
            };
            
            // Send email immediately after successful payment
            console.log(`📧 Sending confirmation email to ${booking.email}`);
            const result = await sendConfirmationEmail(bookingData);
            if (result.success) {
                console.log(`✅ Confirmation email sent to ${booking.email}`);
            } else {
                console.error(`❌ Failed to send email to ${booking.email}:`, result.error);
            }
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

// ====== 7. TEST EMAIL ENDPOINT ======
app.post('/api/test-email', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false,
                error: 'Email is required' 
            });
        }

        if (!emailInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Email service is not configured'
            });
        }

        const testData = {
            booking_id: 'TEST12345',
            pnr: 'TESTPNR123',
            from_city: 'Chennai',
            to_city: 'Bangalore',
            travel_date: new Date().toISOString(),
            boarding: 'Koyambedu Bus Stand',
            dropping: 'Majestic Bus Stand',
            email: email,
            total_amount: 899,
            base_fare: 899,
            cgst: 22,
            sgst: 22,
            service_fee: 15,
            seats: JSON.stringify(['LB1', 'LD2']),
            passengers: JSON.stringify([
                { name: 'Test User 1', age: 30, gender: 'Male' },
                { name: 'Test User 2', age: 28, gender: 'Female' }
            ])
        };

        const result = await sendConfirmationEmail(testData);
        
        res.json({
            success: result.success,
            message: result.success ? 'Test email sent successfully' : 'Failed to send test email',
            details: result
        });

    } catch (error) {
        console.error('❌ Test email error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to send test email',
            details: error.message
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
    console.log(`║   Test Email: POST /api/test-email              ║`);
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
