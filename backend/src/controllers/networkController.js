import { networkStatus } from '../socket/attendanceSocket.js';

export async function status(req, res, next) {
  try {
    const status = await networkStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
}