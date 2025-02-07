import { Router } from 'express';
import { AppDataSource } from '../index.js';
import { Message } from '../entities/Message.js';
import { User } from '../entities/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { redisClient } from '../index.js';

const router = Router();

// Get messages between two users
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const cacheKey = `messages:${req.user.id}:${req.params.userId}`;
    const cachedMessages = await redisClient.get(cacheKey);

    if (cachedMessages) {
      return res.json(JSON.parse(cachedMessages));
    }

    const messages = await AppDataSource.manager.find(Message, {
      where: [
        { sender: req.user.id, receiver: req.params.userId },
        { sender: req.params.userId, receiver: req.user.id }
      ],
      order: {
        createdAt: 'DESC'
      },
      take: 50
    });

    await redisClient.set(cacheKey, JSON.stringify(messages), { EX: 300 }); // Cache for 5 minutes
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching messages' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { receiverId, content } = req.body;

  if (!receiverId || !content) {
    return res.status(400).json({ message: 'Receiver and content are required' });
  }

  try {
    const receiver = await AppDataSource.manager.findOneOrFail(User, { where: { id: receiverId } });

    const message = AppDataSource.manager.create(Message, {
      content,
      sender: req.user.id,
      receiver: receiver.id,
      createdAt: new Date()
    });

    await AppDataSource.manager.save(Message, message);

    const senderCacheKey = `messages:${req.user.id}:${receiverId}`;
    const receiverCacheKey = `messages:${receiverId}:${req.user.id}`;
    await redisClient.del(senderCacheKey, receiverCacheKey); // Invalidate cache

    res.status(201).json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error sending message' });
  }
});

export const messageRouter = router;
