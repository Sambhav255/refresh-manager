const products = [
  {
    name: 'Beginner Training',
    category: 'membership',
    sub_category: 'swimming_training',
    duration_days: 15,
    price: 0
  },
  {
    name: 'Beginner Training',
    category: 'membership',
    sub_category: 'swimming_training',
    duration_days: 30,
    price: 0
  },
  {
    name: 'Advanced Training',
    category: 'membership',
    sub_category: 'swimming_training',
    duration_days: 15,
    price: 0
  },
  {
    name: 'Advanced Training',
    category: 'membership',
    sub_category: 'swimming_training',
    duration_days: 30,
    price: 0
  },
  { name: 'Gym Only', category: 'membership', sub_category: 'gym', duration_days: 30, price: 0 },
  { name: 'Gym Only', category: 'membership', sub_category: 'gym', duration_days: 90, price: 0 },
  { name: 'Gym Only', category: 'membership', sub_category: 'gym', duration_days: 180, price: 0 },
  { name: 'Gym Only', category: 'membership', sub_category: 'gym', duration_days: 365, price: 0 },
  {
    name: 'Swimming + Gym',
    category: 'membership',
    sub_category: 'combined',
    duration_days: 30,
    price: 0
  },
  {
    name: 'Swimming + Gym',
    category: 'membership',
    sub_category: 'combined',
    duration_days: 90,
    price: 0
  },
  {
    name: 'Swimming + Gym',
    category: 'membership',
    sub_category: 'combined',
    duration_days: 180,
    price: 0
  },
  {
    name: 'Swimming + Gym',
    category: 'membership',
    sub_category: 'combined',
    duration_days: 365,
    price: 0
  },
  {
    name: 'Sauna + Steam + Jacuzzi',
    category: 'day_package',
    sub_category: 'package',
    duration_days: null,
    price: 0
  },
  {
    name: 'Swimming + Sauna + Steam',
    category: 'day_package',
    sub_category: 'package',
    duration_days: null,
    price: 0
  },
  {
    name: 'Whole Package',
    category: 'day_package',
    sub_category: 'package',
    duration_days: null,
    price: 0
  },
  {
    name: 'Pool Day Pass',
    category: 'day_pass',
    sub_category: 'pass',
    duration_days: null,
    price: 0
  },
  {
    name: 'Gym Day Pass',
    category: 'day_pass',
    sub_category: 'pass',
    duration_days: null,
    price: 0
  }
]

const poolItems = [
  {
    name: 'Ladies Costume',
    category: 'Swimwear',
    variant: 'Full Body',
    current_stock: 0,
    reorder_level: 3,
    selling_price: 0
  },
  {
    name: 'Ladies Costume',
    category: 'Swimwear',
    variant: 'Half',
    current_stock: 0,
    reorder_level: 3,
    selling_price: 0
  },
  {
    name: 'Gents Costume',
    category: 'Swimwear',
    variant: null,
    current_stock: 0,
    reorder_level: 3,
    selling_price: 0
  },
  {
    name: 'Baby Costume',
    category: 'Swimwear',
    variant: 'Girls',
    current_stock: 0,
    reorder_level: 3,
    selling_price: 0
  },
  {
    name: 'Baby Costume',
    category: 'Swimwear',
    variant: 'Boys',
    current_stock: 0,
    reorder_level: 3,
    selling_price: 0
  },
  {
    name: 'Goggles',
    category: 'Accessories',
    variant: 'Adult Large',
    current_stock: 0,
    reorder_level: 5,
    selling_price: 0
  },
  {
    name: 'Goggles',
    category: 'Accessories',
    variant: 'Adult Small',
    current_stock: 0,
    reorder_level: 5,
    selling_price: 0
  },
  {
    name: 'Goggles',
    category: 'Accessories',
    variant: 'Baby',
    current_stock: 0,
    reorder_level: 5,
    selling_price: 0
  },
  {
    name: 'Swimming Cap',
    category: 'Accessories',
    variant: 'Large',
    current_stock: 0,
    reorder_level: 5,
    selling_price: 0
  },
  {
    name: 'Swimming Cap',
    category: 'Accessories',
    variant: 'Small',
    current_stock: 0,
    reorder_level: 5,
    selling_price: 0
  },
  {
    name: 'Nose Pin',
    category: 'Accessories',
    variant: null,
    current_stock: 0,
    reorder_level: 10,
    selling_price: 0
  },
  {
    name: 'Floating Tube',
    category: 'Equipment',
    variant: null,
    current_stock: 0,
    reorder_level: 2,
    selling_price: 0
  }
]

const restaurantItems = [
  {
    name: 'Tea',
    category: 'Beverages',
    unit: 'cups',
    current_stock: 0,
    reorder_level: 10,
    selling_price: 0
  },
  {
    name: 'Coffee',
    category: 'Beverages',
    unit: 'cups',
    current_stock: 0,
    reorder_level: 10,
    selling_price: 0
  },
  {
    name: 'Water',
    category: 'Beverages',
    unit: 'bottles',
    current_stock: 0,
    reorder_level: 20,
    selling_price: 0
  },
  {
    name: 'Momo',
    category: 'Snacks',
    unit: 'plates',
    current_stock: 0,
    reorder_level: 5,
    selling_price: 0
  },
  {
    name: 'Samosa',
    category: 'Snacks',
    unit: 'pcs',
    current_stock: 0,
    reorder_level: 10,
    selling_price: 0
  }
]

const defaultSettings = [
  { key: 'business_name', value: 'Refresh Recreation Center' },
  { key: 'business_phone', value: '+977 9801010422' },
  { key: 'business_address', value: 'Nayabasti, Boudha, Kathmandu' },
  { key: 'whatsapp_owner_number', value: '' },
  { key: 'eod_auto_send_time', value: '' },
  { key: 'backup_path', value: '' },
  { key: 'currency_symbol', value: 'Rs.' },
  { key: 'expiry_warning_days', value: '5' },
  { key: 'seeded', value: 'true' }
]

export function seedData(db) {
  const seeded = db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get()
  if (seeded?.value === 'true') return

  const insertProduct = db.prepare(`
    INSERT INTO products (name, category, sub_category, duration_days, price)
    VALUES (@name, @category, @sub_category, @duration_days, @price)
  `)
  for (const p of products) {
    insertProduct.run(p)
  }

  const insertPool = db.prepare(`
    INSERT INTO pool_inventory_items (name, category, variant, current_stock, reorder_level, selling_price)
    VALUES (@name, @category, @variant, @current_stock, @reorder_level, @selling_price)
  `)
  for (const item of poolItems) {
    insertPool.run(item)
  }

  const insertRestaurant = db.prepare(`
    INSERT INTO restaurant_inventory_items (name, category, unit, current_stock, reorder_level, selling_price)
    VALUES (@name, @category, @unit, @current_stock, @reorder_level, @selling_price)
  `)
  for (const item of restaurantItems) {
    insertRestaurant.run(item)
  }

  const insertSetting = db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)'
  )
  for (const s of defaultSettings) {
    insertSetting.run(s)
  }
}
