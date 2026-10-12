
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://bnzkgyymwlulsobbcdpp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_i3JcVDLPefiXQUDwOZZQWA_6_R9m2Wx';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
