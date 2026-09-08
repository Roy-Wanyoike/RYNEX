const carsForm = document.getElementById('formCars') as HTMLFormElement;
const addCarBtn = document.getElementById('addCarBtn')!
const delCarBtn = document.getElementById('delCar')!


addCarBtn.addEventListener('click', async (e) => {
  e.preventDefault();
let carModel = document.getElementById('carModel') as HTMLInputElement;
let Bodytype = document.getElementById('bodyType') as HTMLInputElement;
let Brand = document.getElementById("price") as HTMLInputElement;
let Image = document.getElementById('image') as HTMLInputElement;
let IsDeleted = document.getElementById('isDeleted') as HTMLInputElement;

let Cars = await addCars (carModel.value,Bodytype.value,Brand.value,Image.value,IsDeleted)
 if(Cars){
    window.location.href = '../Admin/admin.html'
 }
})

const addCars =async (carModel:string,Bodytype:string,Brand:string,image:string,IsDeleted:HTMLInputElement) => {
    console.log(carModel,Bodytype,Brand,Image,IsDeleted);
    let feedback = await fetch("", {
        method:"POST",
        body : JSON.stringify({
            carModel,
            Bodytype,
            Brand,
            Image,
            IsDeleted:IsDeleted.checked? "1":"0"
        }),
        headers: {
            "content-type": "application/json"
        }
    })
    
    if(feedback.status === 200){
        let Cars = await feedback.json();
        return Cars;
    }else{
        console.error();
                
    }
}
const getCars = async () => {
    let response = await fetch(" http://localhost:4000/products//getproducts");
    if (response.status === 200) {
        let Cars = await response.json();
        return Cars;
    } else {
        console.log("error");
    }
}