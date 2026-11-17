CREATE TABLE `product_pricing` (
  `Keycode` int NOT NULL,
  `Barcode` varchar(13) NOT NULL,
  `LocationID` varchar(13) NOT NULL,
  `Price` decimal(5,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
