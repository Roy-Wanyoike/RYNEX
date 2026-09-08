// RYNEX — FALLBACK DEMO CATALOGUE (PRODUCT ID : DATA)
// ---------------------------------------------------------------------------
// Used ONLY when the server catalogue (GET /products/getproducts) cannot be
// reached: cart.js replaces this map with live server rows on success.
// Rules: numeric prices only, unique numeric keys, and every img file must
// exist in src/cart/images/. (Junk demo entries removed; the duplicated key
// 133 was renumbered to 135.)
// ---------------------------------------------------------------------------
let products = {
  123: {
    name : "Audi A4 2020",
    img : "audi.jpeg",
    price : 2000000
  },
  124: {
    name : "Audi A4 2021",
    img : "audiA4.jpg",
    price : 2500000
  },
  125: {
    name : "Audi A5 2021",
    img : "audiA5.jpg",
    price : 2500000
  },
  126: {
    name : "Mercedes Benz C200 2021",
    img : "benz.jpeg",
    price : 3500000
  },
  127: {
    name : "BMW X6 2021",
    img : "bmw.jpeg",
    price : 2800000
  },
  128: {
    name : "Jeep Wrangler 2021",
    img : "jeep.jpg",
    price : 5500000
  },
  129: {
    name : "Mazda CX5 2016",
    img : "mazdacx5.jpg",
    price : 1500000
  },
  130: {
    name : "Mazda MX5 2016",
    img : "mazdamx5.jpg",
    price : 2500000
  },
  132: {
    name : "Volkswagen Passat",
    img : "vwred.png",
    price : 2400000
  },
  135: {
    name : "Volkswagen Touareg V6",
    img : "vwToureg.jpg",
    price : 1900000
  }
};
