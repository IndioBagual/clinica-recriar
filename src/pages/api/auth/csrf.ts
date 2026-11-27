import type { NextApiRequest, NextApiResponse } from 'next';
import { issueCsrfCookie } from '@/lib/security/csrf';
import { applyNoStoreHeaders, requireMethod } from '@/lib/security/http';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['GET'])) return;

  const csrfToken = issueCsrfCookie(req, res);
  res.status(200).json({ csrfToken });
}