import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Product } from '../catalog/api';
import { DEFAULT_CARD_TOKEN } from '../payments/model';
import { newUuid } from '../../shared/utils/format';

const CART_STORAGE_KEY = 'ff_ecommerce_cart_v1';

export interface CartItem {
  sku: string;
  name: string;
  unitPrice: number;
  currency: string;
  quantity: number;
}

interface PersistedCart {
  items: CartItem[];
  idempotencyKey: string;
  cardToken: string;
}

interface CartContextValue {
  items: CartItem[];
  totalCount: number;
  idempotencyKey: string;
  cardToken: string;
  addItem: (product: Product, quantity?: number) => void;
  setQuantity: (sku: string, quantity: number) => void;
  removeItem: (sku: string) => void;
  setCardToken: (token: string) => void;
  clearCart: () => void;
  rotateIdempotencyKey: () => string;
}

const CartContext = createContext<CartContextValue | null>(null);

function loadInitialCart(): PersistedCart {
  try {
    const raw = sessionStorage.getItem(CART_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedCart>;
      if (Array.isArray(parsed.items) && typeof parsed.idempotencyKey === 'string' && parsed.idempotencyKey) {
        return {
          items: parsed.items,
          idempotencyKey: parsed.idempotencyKey,
          cardToken:
            typeof parsed.cardToken === 'string' && parsed.cardToken.trim()
              ? parsed.cardToken
              : DEFAULT_CARD_TOKEN,
        };
      }
    }
  } catch {
    // Ignore storage read failures in restricted environments
  }
  return { items: [], idempotencyKey: newUuid(), cardToken: DEFAULT_CARD_TOKEN };
}

/**
 * Client-side cart paired with an explicit Idempotency-Key per checkout attempt:
 * - Persisted in sessionStorage (items, cardToken, key only — never auth tokens) so guest carts
 *   survive the Keycloak Authorization Code + PKCE redirect.
 * - Retrying after a 503 or timeout reuses the same key (safe idempotent replay).
 * - Modifying cart items or cardToken automatically rotates the key so the backend does not reject
 *   with 409 (IdempotencyKeyReusedException).
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const [initial] = useState<PersistedCart>(() => loadInitialCart());
  const [items, setItems] = useState<CartItem[]>(initial.items);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(initial.idempotencyKey);
  const [cardToken, setCardTokenState] = useState<string>(initial.cardToken);

  useEffect(() => {
    try {
      sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items, idempotencyKey, cardToken }));
    } catch {
      // Ignore storage quota errors
    }
  }, [items, idempotencyKey, cardToken]);

  const rotateIdempotencyKey = useCallback(() => {
    const next = newUuid();
    setIdempotencyKey(next);
    return next;
  }, []);

  const addItem = useCallback((product: Product, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.sku === product.sku);
      if (existing) {
        return prev.map((item) =>
          item.sku === product.sku
            ? { ...item, quantity: item.quantity + quantity, unitPrice: product.unitPrice, name: product.name }
            : item,
        );
      }
      return [
        ...prev,
        {
          sku: product.sku,
          name: product.name,
          unitPrice: product.unitPrice,
          currency: product.currency,
          quantity,
        },
      ];
    });
    setIdempotencyKey(newUuid());
  }, []);

  const setQuantity = useCallback((sku: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((item) => item.sku !== sku));
    } else {
      setItems((prev) => prev.map((item) => (item.sku === sku ? { ...item, quantity } : item)));
    }
    setIdempotencyKey(newUuid());
  }, []);

  const removeItem = useCallback((sku: string) => {
    setItems((prev) => prev.filter((item) => item.sku !== sku));
    setIdempotencyKey(newUuid());
  }, []);

  const setCardToken = useCallback((token: string) => {
    setCardTokenState(token);
    setIdempotencyKey(newUuid());
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setCardTokenState(DEFAULT_CARD_TOKEN);
    setIdempotencyKey(newUuid());
  }, []);

  const totalCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      totalCount,
      idempotencyKey,
      cardToken,
      addItem,
      setQuantity,
      removeItem,
      setCardToken,
      clearCart,
      rotateIdempotencyKey,
    }),
    [
      items,
      totalCount,
      idempotencyKey,
      cardToken,
      addItem,
      setQuantity,
      removeItem,
      setCardToken,
      clearCart,
      rotateIdempotencyKey,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used inside CartProvider');
  }
  return ctx;
}
