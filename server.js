// server.js - Jayam Travels Booking Backend
// Deploy on Render with TiDB MySQL

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
       'https://yogajayam.netlify.app'
];
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ====== ROOT ROUTE ======
app.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: 'Jayam Travels API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        services: {
            razorpay: process.env.RAZORPAY_KEY_ID ? '✅ Configured' : '❌ Not Configured',
            email: process.env.EMAIL_USER && process.env.EMAIL_PASS ? '✅ Configured' : '❌ Not Configured',
            database: process.env.DB_NAME || 'Not Set'
        }
    });
});

// ====== DATABASE CONNECTION ======
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
let razorpay = null;
let razorpayInitialized = false;

function initializeRazorpay() {
    try {
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || keyId === 'rzp_test_xxxxxxxxxx' || keyId.length < 10) {
            console.error('❌ Invalid Razorpay Key ID');
            razorpayInitialized = false;
            return false;
        }

        if (!keySecret || keySecret === 'xxxxxxxxxxxxxxxxxxxx' || keySecret.length < 10) {
            console.error('❌ Invalid Razorpay Key Secret');
            razorpayInitialized = false;
            return false;
        }

        razorpay = new Razorpay({
            key_id: keyId,
            key_secret: keySecret
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

// ====== EMAIL INITIALIZATION ======
let emailTransporter = null;
let emailInitialized = false;

function initializeEmail() {
    try {
        const emailUser = process.env.EMAIL_USER;
        const emailPass = process.env.EMAIL_PASS;

        console.log('📧 Checking email configuration...');
        console.log(`   EMAIL_USER: ${emailUser ? '✅ Set' : '❌ Not set'}`);
        console.log(`   EMAIL_PASS: ${emailPass ? '✅ Set' : '❌ Not set'}`);

        if (!emailUser || !emailPass) {
            console.error('❌ Email credentials not configured');
            emailInitialized = false;
            return false;
        }

        // Check if it's Gmail
        const isGmail = emailUser.includes('@gmail.com');
        console.log(`   Email Provider: ${isGmail ? 'Gmail' : 'Custom SMTP'}`);

        let transporterConfig;

        if (isGmail) {
            // Gmail configuration
            transporterConfig = {
                service: 'gmail',
                auth: {
                    user: emailUser,
                    pass: emailPass // This should be the App Password
                },
                // Add timeout settings
                connectionTimeout: 30000,
                greetingTimeout: 30000,
                socketTimeout: 30000
            };
        } else {
            // Custom SMTP configuration (for non-Gmail)
            transporterConfig = {
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: process.env.SMTP_PORT || 587,
                secure: process.env.SMTP_SECURE === 'true' || false,
                auth: {
                    user: emailUser,
                    pass: emailPass
                }
            };
        }

        emailTransporter = nodemailer.createTransport(transporterConfig);

        // Verify connection synchronously with timeout
        console.log('📧 Verifying email connection...');
        
        return new Promise((resolve) => {
            emailTransporter.verify(function(error, success) {
                if (error) {
                    console.error('❌ Email verification failed:', error.message);
                    console.error('   💡 Possible reasons:');
                    console.error('   - Invalid App Password (use 16-char password with spaces)');
                    console.error('   - 2FA not enabled on Gmail account');
                    console.error('   - Less secure app access blocked');
                    console.error('   - Wrong email address');
                    emailInitialized = false;
                    resolve(false);
                } else {
                    console.log('✅ Email service ready to send emails');
                    emailInitialized = true;
                    resolve(true);
                }
            });
        });

    } catch (error) {
        console.error('❌ Email initialization error:', error.message);
        emailInitialized = false;
        return false;
    }
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

// ====== SEND CONFIRMATION EMAIL ======
async function sendConfirmationEmail(bookingData) {
    if (!emailInitialized) {
        console.warn('⚠️ Email not initialized - Skipping email send');
        return { success: false, error: 'Email service not configured' };
    }

    try {
        const seats = typeof bookingData.seats === 'string' ? JSON.parse(bookingData.seats) : bookingData.seats;
        const passengers = typeof bookingData.passengers === 'string' ? JSON.parse(bookingData.passengers) : bookingData.passengers;

        const mailOptions = {
            from: `"Jayam Travels" <${process.env.EMAIL_USER}>`,
            to: bookingData.email,
            cc: process.env.EMAIL_USER,
            subject: `🎫 Jayam Travels - Booking Confirmed (${bookingData.booking_id})`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa; border-radius: 10px;">
                    <div style="text-align: center; background: linear-gradient(135deg, #e63946, #f77f00); padding: 20px; border-radius: 10px 10px 0 0; color: #fff;">
                        <h1 style="margin: 0;">🚌 Jayam Travels</h1>
                        <p style="margin: 5px 0 0;">Booking Confirmed!</p>
                    </div>
                    <div style="background: #fff; padding: 20px; border-radius: 0 0 10px 10px;">
                        <h2 style="color: #e63946;">Booking Details</h2>
                        <p><strong>Booking ID:</strong> ${bookingData.booking_id}</p>
                        <p><strong>PNR:</strong> ${bookingData.pnr}</p>
                        <p><strong>Route:</strong> ${bookingData.from_city} → ${bookingData.to_city}</p>
                        <p><strong>Date:</strong> ${new Date(bookingData.travel_date).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'})}</p>
                        <p><strong>Boarding:</strong> ${bookingData.boarding}</p>
                        <p><strong>Dropping:</strong> ${bookingData.dropping}</p>
                        <p><strong>Seats:</strong> ${seats.join(', ')}</p>
                        <p><strong>Total Amount:</strong> ₹${bookingData.total_amount}</p>
                        <hr>
                        <p style="color: #666; font-size: 14px;">Thank you for choosing Jayam Travels!</p>
                    </div>
                </div>
            `,
            text: `Jayam Travels - Booking Confirmed\n\nBooking ID: ${bookingData.booking_id}\nPNR: ${bookingData.pnr}\nRoute: ${bookingData.from_city} → ${bookingData.to_city}\nTotal: ₹${bookingData.total_amount}`
        };

        const info = await emailTransporter.sendMail(mailOptions);
        console.log(`✅ Confirmation email sent to ${bookingData.email}`);
        console.log(`📧 Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ Email error:', error.message);
        return { success: false, error: error.message };
    }
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API is running',
        timestamp: new Date().toISOString()
    });
});

// Status check - shows all service status
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        services: {
            razorpay: razorpayInitialized ? '✅ Configured' : '❌ Not configured',
            email: emailInitialized ? '✅ Configured' : '❌ Not configured',
            database: process.env.DB_NAME || 'Not Set'
        },
        environment: process.env.NODE_ENV || 'development',
        email_config: {
            user: process.env.EMAIL_USER ? '✅ Set' : '❌ Not set',
            pass: process.env.EMAIL_PASS ? '✅ Set' : '❌ Not set'
        }
    });
});

// Test email endpoint
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
                error: 'Email service not configured',
                details: 'Please check EMAIL_USER and EMAIL_PASS environment variables'
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
                { name: 'Test User', age: 30, gender: 'Male' }
            ])
        };

        const result = await sendConfirmationEmail(testData);
        res.json({
            success: result.success,
            message: result.success ? '✅ Test email sent successfully' : '❌ Failed to send test email',
            details: result
        });

    } catch (error) {
        console.error('❌ Test email error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ====== 1. CREATE BOOKING ======
app.post('/api/bookings', async (req, res) => {
    let connection;
    try {
        console.log('📝 Creating booking...');
        
        const {
            from, to, date, seats, passengers, boarding, dropping,
            email, mobile, state, insurance, base_fare, cgst, sgst, service_fee, total_amount
        } = req.body;

        // Validate required fields
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
            return res.status(400).json({ success: false, error: 'Invalid email address' });
        }

        // Validate mobile
        const mobileRegex = /^[6-9]\d{9}$/;
        if (!mobileRegex.test(mobile)) {
            return res.status(400).json({ success: false, error: 'Invalid mobile number' });
        }

        // Check Razorpay
        if (!razorpayInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Payment service not configured'
            });
        }

        // Generate IDs
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

        // Send email in background (after 2 minutes)
        if (emailInitialized) {
            setTimeout(async () => {
                const bookingData = {
                    booking_id, pnr, from_city: from, to_city: to,
                    travel_date: date, seats: seatsJson, passengers: passengersJson,
                    boarding, dropping, email, mobile, state,
                    total_amount, base_fare, cgst, sgst, service_fee
                };
                await sendConfirmationEmail(bookingData);
            }, 120000);
        }

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

// ====== 2. CREATE RAZORPAY ORDER ======
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

        // Verify signature
        const sign = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest('hex');

        if (expectedSign !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                error: 'Payment verification failed'
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

        // Get booking details
        const [bookings] = await connection.query(
            'SELECT * FROM bookings WHERE booking_id = ?',
            [booking_id]
        );

        connection.release();

        // Send confirmation email
        if (bookings.length > 0 && emailInitialized) {
            const booking = bookings[0];
            booking.seats = JSON.parse(booking.seats);
            booking.passengers = JSON.parse(booking.passengers);
            
            await sendConfirmationEmail({
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
                total_amount: booking.total_amount,
                base_fare: booking.base_fare,
                cgst: booking.cgst,
                sgst: booking.sgst,
                service_fee: booking.service_fee
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

// ====== 4. GET BOOKING ======
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

// ====== 5. GET BOOKINGS BY EMAIL ======
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
            try { await connection.rollback(); } catch (e) {}
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
        path: req.url
    });
});

// ====== START SERVER ======
app.listen(PORT, async () => {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║   🚌 Jayam Travels - Backend Server             ║');
    console.log('╠═══════════════════════════════════════════════════╣');
    console.log(`║   Server running on port: ${PORT}                ║`);
    console.log(`║   Environment: ${process.env.NODE_ENV || 'development'}                 ║`);
    console.log('╠═══════════════════════════════════════════════════╣');

    initializeRazorpay();
    await initializeEmail();
    await checkDatabaseSetup();

    console.log('╠═══════════════════════════════════════════════════╣');
    console.log(`║   Razorpay: ${razorpayInitialized ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`║   Email: ${emailInitialized ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`║   Database: ${process.env.DB_NAME || 'Not Set'}`);
    console.log('╠═══════════════════════════════════════════════════╣');
    console.log(`║   Test Email: POST /api/test-email              ║`);
    console.log(`║   Status: GET /api/status                       ║`);
    console.log('╚═══════════════════════════════════════════════════╝');
});

module.exports = app;
