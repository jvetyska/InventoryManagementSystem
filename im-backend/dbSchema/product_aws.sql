CREATE TABLE `product_aws` (
  `LocationID` varchar(13) NOT NULL,
  `Keycode` int NOT NULL,
  `ProductID` varchar(13) DEFAULT NULL,
  `AWS` float DEFAULT NULL,
  `AWS_4W` float DEFAULT NULL,
  `AWS_1W` float DEFAULT NULL,
  `AWS_8W` float DEFAULT NULL,
  `AWS_52W` float DEFAULT NULL,
  `AWSDays` int DEFAULT NULL,
  `AWSDaysTotal` int DEFAULT NULL,
  `DateCreated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tempAWSDays` int DEFAULT NULL,
  PRIMARY KEY (`LocationID`,`Keycode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
