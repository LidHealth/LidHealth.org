window.LidHealthCart=(()=>{
  const key="lidhealth-cart";
  function isCartItem(item){
    return item&&typeof item.k==="string"&&typeof item.name==="string"&&typeof item.label==="string"&&Number.isFinite(item.price)&&item.price>=0&&Number.isInteger(item.qty)&&item.qty>0;
  }
  function load(){
    const saved=localStorage.getItem(key);
    if(saved===null)return[];
    let cart;
    try{cart=JSON.parse(saved)}catch(error){throw new Error(`Could not read the saved cart: ${error.message}`)}
    if(!Array.isArray(cart)||!cart.every(isCartItem))throw new Error("The saved cart has invalid data. Clear this site's saved cart data to continue.");
    return cart;
  }
  function save(cart){
    if(!Array.isArray(cart)||!cart.every(isCartItem))throw new Error("The cart contains invalid item data and was not saved.");
    try{localStorage.setItem(key,JSON.stringify(cart))}catch(error){throw new Error(`Could not save your cart: ${error.message}`)}
  }
  return{load,save};
})();
