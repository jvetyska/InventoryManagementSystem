CREATE TABLE `product_discount_pdu` (
  `DiscountRawID` int NOT NULL,
  `LocationID` varchar(45) NOT NULL,
  `PDU` int NOT NULL,
  PRIMARY KEY (`DiscountRawID`,`LocationID`,`PDU`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
