let carDiv = document.querySelector('car') as HTMLDivElement
interface cars {

    car: string;
    image: string;
    price: number
}

let car: cars[] = []


// Fetch all the cars
function getAllCars(cars: cars[]){
    fetch('cars url endpoint')
    .then((response) => response.json())
    .then((data)=>{
        car = data;
        return data;
    }).catch((error) =>
    console.log(error));
}
getAllCars()

// Update Car data

function updateCar(): void{
    fetch('update endpoint')
    .then((response) => response.json())
    .then((data)=>{
        car = data;
      }  )
}

// display the cars

function displayCar(): void{
    car.forEach((car)=>{
        let html = `
        <div class="car">
                ${car.image}
            <div class="btn">
              <button class="quote">${getQuote}</button>
            <button class="reserve">${AddToCart}</button>
            </div>
          </div>
        `
        console.log(car)
        carDiv.innerHTML += html
      }  )
}
displayCar ()

function getQuote (): void {
fetch('car details endpoint')
.then((response) => response.json())
.then((data)=>{
    const carInfo = data
    return carInfo
})
.catch((error) => {
    console.log(error)
})

}