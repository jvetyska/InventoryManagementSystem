exports.getFamilyTreeQuery = () => {
    return `
        SELECT
            DepartmentID,
            FamilyID,
            ClassID,
            SubClassID,
            SubSubClassID,
            DepartmentName,
            FamilyName,
            ClassName,
            SubClassName,
            SubSubClassName
        FROM product_family_tree;
    `;
}

exports.getInsertProductsBarcodeTblQuery = () => {
    return `
    INSERT IGNORE INTO product_barcode (
        Keycode,
        Barcode
    )
    VALUES ?
        ON DUPLICATE KEY UPDATE
    Keycode = VALUES(Keycode)
    `;
}

exports.getInsertToProductTblQuery = () => {

    return `
    INSERT IGNORE INTO product (
        Keycode,
        APN,
        Product_Name,
        DepartmentID,
        Class_Name,
        Sub_Class_Name,
        Sub_Sub_Class_Name,
        Product_Status,
        Business_Unit_RBU_Name,
        Description,
        Item_Size,
        Cost_Price_Aus,
        Sell_Price_Aus,
        Secondary_Colour,
        Style_ID,
        isRecall
    ) VALUES ?
    ON DUPLICATE KEY UPDATE
        Keycode=VALUES(Keycode),
        APN=VALUES(APN),
        Product_Name=VALUES(Product_Name),
        DepartmentID=VALUES(DepartmentID),
        Class_Name=VALUES(Class_Name),
        Sub_Class_Name=VALUES(Sub_Class_Name),
        Sub_Sub_Class_Name=VALUES(Sub_Sub_Class_Name),
        Product_Status=VALUES(Product_Status),
        Business_Unit_RBU_Name=VALUES(Business_Unit_RBU_Name),
        Description=VALUES(Description),
        Item_Size=VALUES(Item_Size),
        Cost_Price_Aus=VALUES(Cost_Price_Aus),
        Sell_Price_Aus=VALUES(Sell_Price_Aus),
        Secondary_Colour=VALUES(Secondary_Colour),
        Style_ID=VALUES(Style_ID),
        isRecall=VALUES(isRecall)
    `;
}

exports.getInsertToProductAttrTblQuery = () => {
    return `
    INSERT IGNORE INTO product_attr (
        Keycode,
        APN,
        Department_ID,
        Minor_Department_ID,
        Family_ID,
        Class_ID,
        Fixture_Code
    ) VALUES ?
    ON DUPLICATE KEY UPDATE
        Keycode=VALUES(Keycode),
        APN=VALUES(APN),
        Department_ID=VALUES(Department_ID),
        Minor_Department_ID=VALUES(Minor_Department_ID),
        Family_ID=VALUES(Family_ID),
        Class_ID=VALUES(Class_ID),
        Fixture_Code=VALUES(Fixture_Code)
    `;

}
