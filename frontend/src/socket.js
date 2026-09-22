import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getToken } from './api/client';

export const socket = io({
  autoConnect: false,
  transports: ['websocket'],
  auth: (cb) => cb({ token: getToken() }),
});

export function connectSocket() {
  if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
  socket.disconnect();
}

/**
 * Subscribe to realtime events. `handlers` maps event names to callbacks.
 * Returns a cleanup fn.
 */
export function useRealtime(handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const listeners = Object.entries(handlersRef.current).map(([event, fn]) => {
      socket.on(event, fn);
      return [event, fn];
    });
    return () => {
      for (const [event, fn] of listeners) socket.off(event, fn);
    };
  }, []);
}