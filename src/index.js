import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { DataSource } from 'typeorm';
import { createClient } from 'redis';
import jwt from 'jsonwebtoken';
import { User } from './entities/User.js';
import { Message } from './entities/Message.js';
import { authRouter } from './routes/auth.js';
import { messageRouter } from './routes/messages.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
  }
});

// Database connection
export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT) || 5432,
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "chat_db",
  synchronize: true,
  logging: false,
  entities: [User, Message],
});

// Redis client with enhanced error handling
export const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
  password: process.env.REDIS_PASSWORD,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis connection failed after 10 retries');
        return new Error('Redis connection failed');
      }
      return Math.min(retries * 100, 3000);
    }
  }
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('Connected to Redis');
});

redisClient.on('reconnecting', () => {
  console.log('Reconnecting to Redis...');
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/auth', authRouter);
app.use('/messages', messageRouter);

// Socket.IO middleware for authentication
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '');
    socket.userId = decoded.id;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

// Socket.IO connection handling
io.on('connection', async (socket) => {
  console.log(`User connected: ${socket.userId}`);
  
  try {
    // Store socket ID in Redis with 24h expiration
    await redisClient.set(`user:${socket.userId}`, socket.id, {
      EX: 86400 // 24 hours
    });
  } catch (error) {
    console.error('Error storing socket ID in Redis:', error);
  }

  socket.on('message', async (data) => {
    try {
      const message = new Message();
      message.content = data.content;
      message.sender = socket.userId;
      message.receiver = data.receiver;
      
      await AppDataSource.manager.save(message);

      try {
        // Get receiver's socket ID from Redis
        const receiverSocketId = await redisClient.get(`user:${data.receiver}`);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message', {
            id: message.id,
            content: message.content,
            sender: message.sender,
            createdAt: message.createdAt
          });
        }
      } catch (redisError) {
        console.error('Redis error when sending message:', redisError);
        // Message is saved but real-time delivery failed
        // Could implement a retry mechanism here
      }
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  socket.on('disconnect', async () => {
    try {
      await redisClient.del(`user:${socket.userId}`);
      console.log(`User disconnected: ${socket.userId}`);
    } catch (error) {
      console.error('Error removing socket ID from Redis:', error);
    }
  });
});

// Initialize connections and start server
const PORT = process.env.PORT || 3000;

Promise.all([
  AppDataSource.initialize(),
  redisClient.connect()
]).then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(error => {
  console.error('Error during initialization:', error);
});