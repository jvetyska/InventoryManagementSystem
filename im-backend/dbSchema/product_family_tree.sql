CREATE TABLE `product_family_tree` (
  `DepartmentID` varchar(10) NOT NULL COMMENT 'Kmart allows leading zeroes (such as 005). Therefore, IDs should be treated as a string/varchar instead of an integer so the leading zeroes of Kmart''s data is preserved',
  `FamilyID` varchar(10) NOT NULL,
  `ClassID` varchar(10) NOT NULL,
  `SubClassID` varchar(10) NOT NULL,
  `SubSubClassID` varchar(10) NOT NULL,
  `DepartmentName` varchar(50) NOT NULL,
  `FamilyName` varchar(50) NOT NULL,
  `ClassName` varchar(50) NOT NULL,
  `SubClassName` varchar(50) NOT NULL,
  `SubSubClassName` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Kmart allows leading zeroes (such as 005). Therefore, IDs should be treated as a string/varchar instead of an integer so the leading zeroes of Kmart''s data is preserved';
