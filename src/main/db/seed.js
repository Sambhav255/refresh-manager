const sampleProducts = [
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

const samplePoolItems = [
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

const sampleRestaurantItems = [
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
  // Wave 2: new installs land on the one-screen till. Existing databases keep
  // whatever they already have — seedData only runs once and migrations use
  // INSERT OR IGNORE, so an owner who turned it off stays off.
  { key: 'unified_till', value: '1' },
  { key: 'seeded', value: 'true' }
]

// The sample catalogue is kept — it is a reasonable starter list for a pool and
// a kitchen — but it is no longer inflicted on every new install. A future
// "Load sample data" button can call loadSampleCatalogue(); nothing calls it
// today.
export const sampleCatalogue = {
  products: sampleProducts,
  poolItems: samplePoolItems,
  restaurantItems: sampleRestaurantItems
}

// Opt-in loader for the sample catalogue. Every row is checked first, so
// running it on a database that already holds some of these names adds only
// what is missing instead of creating the duplicate rows staff then have to
// choose between. Returns how many rows of each kind were actually inserted.
export function loadSampleCatalogue(db) {
  const counts = { products: 0, poolItems: 0, restaurantItems: 0 }

  const productExists = db.prepare(
    `SELECT id FROM products
     WHERE name = @name AND category = @category
       AND IFNULL(sub_category, '') = IFNULL(@sub_category, '')
       AND IFNULL(duration_days, -1) = IFNULL(@duration_days, -1)`
  )
  const insertProduct = db.prepare(
    `INSERT INTO products (name, category, sub_category, duration_days, price)
     VALUES (@name, @category, @sub_category, @duration_days, @price)`
  )
  const poolExists = db.prepare(
    `SELECT id FROM pool_inventory_items
     WHERE is_active = 1 AND name = @name AND IFNULL(variant, '') = IFNULL(@variant, '')`
  )
  const insertPool = db.prepare(
    `INSERT INTO pool_inventory_items (name, category, variant, current_stock, reorder_level, selling_price)
     VALUES (@name, @category, @variant, @current_stock, @reorder_level, @selling_price)`
  )
  const restaurantExists = db.prepare(
    `SELECT id FROM restaurant_inventory_items WHERE is_active = 1 AND name = @name`
  )
  const insertRestaurant = db.prepare(
    `INSERT INTO restaurant_inventory_items (name, category, unit, current_stock, reorder_level, selling_price)
     VALUES (@name, @category, @unit, @current_stock, @reorder_level, @selling_price)`
  )

  const load = db.transaction(() => {
    for (const p of sampleProducts) {
      if (productExists.get(p)) continue
      insertProduct.run(p)
      counts.products += 1
    }
    for (const item of samplePoolItems) {
      if (poolExists.get(item)) continue
      insertPool.run(item)
      counts.poolItems += 1
    }
    for (const item of sampleRestaurantItems) {
      if (restaurantExists.get(item)) continue
      insertRestaurant.run(item)
      counts.restaurantItems += 1
    }
  })
  load()
  return counts
}

// A new database gets its settings and NOTHING else. The 34 catalogue rows that
// used to ship here were all priced 0, which both buried the owner in items
// nobody had chosen and left the staff Sell Item screen permanently empty (it
// only lists items priced above 0). The `seeded` guard is what protects a live
// install: seedData returns immediately, so an upgrade can neither re-insert
// this data nor overwrite settings the owner has since changed.
export function seedData(db) {
  const seeded = db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get()
  if (seeded?.value === 'true') return

  const insertSetting = db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)'
  )
  for (const s of defaultSettings) {
    insertSetting.run(s)
  }
}
